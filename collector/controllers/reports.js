const Readable = require('stream').Readable
const url = require('url')

const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

let altcurrency

/*
   GET /v1/reports/file/{reportId}
 */

v1.getFile = {
  handler: (runtime) => {
    return async (request, reply) => {
      const database = runtime.database
      const debug = braveHapi.debug(module, request)
      const reportId = request.params.reportId
      let reader, writer

      const file = await database.file(reportId, 'r')
      if (!file) return reply(boom.notFound('no such report: ' + reportId))

      reader = database.source({ filename: reportId })
      reader.on('error', (err) => {
        debug('getFile error', err)
        reply(boom.badImplementation('Sic transit gloria mundi: ' + reportId))
      }).on('open', () => {
        debug('getFile open', underscore.pick(file, [ 'contentType', 'metadata' ]))
        writer = reply(new Readable().wrap(reader))
        if (file.contentType) writer = writer.type(file.contentType)
        underscore.keys(file.metadata || {}).forEach((header) => { writer = writer.header(header, file.metadata[header]) })
      })
    }
  },

  description: 'Gets a report file',
  tags: [ 'api' ],

  validate:
    { params: { reportId: Joi.string().guid().required().description('the report identifier') } }
}

v1.publisher = {}
v1.publishers = {}

/*
   GET /v1/reports/publishers/monthly/contributions
 */

v1.publishers.monthly = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-monthly-contributions',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'analysis', 'ledger' ],
    mode: 'required'
  },

  description: 'Returns information about monthly contributions to publishers',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   GET /v1/reports/publisher/{publisher}/contributions
   GET /v1/reports/publishers/contributions
 */

v1.publisher.contributions = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-collector-contributions',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   request.params, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'analysis', 'ledger' ],
    mode: 'required'
  },

  description: 'Returns information about contributions to a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      analysis: Joi.boolean().default(true).description('return collector analysis (forces summary)')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

v1.publishers.contributions = {
  handler: (runtime) => {
    return async (request, reply) => {
      const amount = request.query.amount
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const currency = request.query.currency.toUpperCase()
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const threshold = runtime.currency.fiat2alt(currency, amount, altcurrency)

      await runtime.queue.send(debug, 'report-publishers-collector-contributions',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { threshold: threshold }, request.query))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'analysis', 'ledger' ],
    mode: 'required'
  },

  description: 'Returns information about contributions to publishers with collector annotations',
  tags: [ 'api' ],

  validate: {
    query: {
      format: Joi.string().valid('json', 'csv').optional().default('csv').description('the format of the report'),
      summary: Joi.boolean().optional().default(true).description('summarize report'),
      balance: Joi.boolean().optional().default(true).description('show balance due'),
      analysis: Joi.boolean().default(true).description('return collector analysis (forces summary)'),
      authorized: Joi.boolean().optional().description('filter on authorization status'),
      verified: Joi.boolean().optional().description('filter on verification status'),
      amount: Joi.number().integer().min(0).optional().description('the minimum amount in fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/reports/file/{reportId}').config(v1.getFile),
  braveHapi.routes.async().path('/v1/reports/publishers/monthly/contributions').config(v1.publishers.monthly),
  braveHapi.routes.async().path('/v1/reports/publisher/{publisher}/contributions').config(v1.publisher.contributions),
  braveHapi.routes.async().path('/v1/reports/publishers/contributions').config(v1.publishers.contributions)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}
