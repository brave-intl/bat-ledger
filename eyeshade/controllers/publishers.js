const url = require('url')

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const batPublisher = require('bat-publisher')
const getPublisher = batPublisher.getPublisher
const getPublisherProps = batPublisher.getPublisherProps
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const common = require('./common.js')
const getToken = common.getToken
const putToken = common.putToken

const v1 = {}
const v2 = {}

let altcurrency

/*
   POST /v1/publishers
*/

v1.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let publisher, state

      for (let entry of payload) {
        publisher = await publishers.findOne({ publisher: entry.publisher, verified: true })
        if (publisher) return reply(boom.badData('publisher ' + entry.publisher + ' already verified'))
      }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { verified: true, reason: 'bulk loaded', authority: authority }
      }
      for (let entry of payload) {
        entry.verificationId = uuid.v4().toLowerCase()
        underscore.extend(state.$set, { token: entry.verificationId })
        await tokens.update({ publisher: entry.publisher, verificationId: entry.verificationId }, state, { upsert: true })
      }

      await runtime.queue.send(debug, 'publishers-bulk-create',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { publishers: payload }, request.query))
      reply({ reportURL: reportURL })
    }
  },
  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Creates publisher entries in bulk',
  tags: [ 'api', 'deprecated' ],

  validate: {
    query: { format: Joi.string().valid('json', 'csv').optional().default('json').description('the format of the report') },
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      name: Joi.string().min(1).max(40).required().description('contact name'),
      email: Joi.string().email().required().description('contact email address'),
      phone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).required().description('contact phone number'),
      show_verification_status: Joi.boolean().optional().default(true).description('public display authorized')
    }).unknown(true)).required().description('publisher bulk entries')
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   POST /v2/publishers/settlement
 */

v2.settlement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      const fields = [ 'probi', 'amount', 'fees', 'commission' ]
      let state

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: {}
      }
      for (let entry of payload) {
        if (entry.altcurrency !== altcurrency) return reply(boom.badData('altcurrency should be ' + altcurrency))

        entry.commission = new BigNumber(entry.commission).plus(new BigNumber(entry.fee)).toString()
        fields.forEach((field) => { state.$set[field] = bson.Decimal128.fromString(entry[field].toString()) })
        underscore.extend(state.$set, underscore.pick(entry, [ 'address', 'altcurrency', 'currency', 'hash' ]))

        await settlements.update({ settlementId: entry.transactionId, publisher: entry.publisher }, state, { upsert: true })
      }

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Posts a settlement for one or more publishers',
  tags: [ 'api' ],

  validate: {
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      address: Joi.string().guid().required().description('settlement address'),
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      probi: braveJoi.string().numeric().required().description('the settlement in probi'),
      currency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the deposit currency'),
      amount: braveJoi.string().numeric().required().description('the amount in the deposit currency'),
      commission: braveJoi.string().numeric().default('0.00').description('settlement commission'),
      fee: braveJoi.string().numeric().default('0.00').description('additional settlement fee'),
      transactionId: Joi.string().guid().description('the transactionId'),
      hash: Joi.string().guid().required().description('settlement-identifier')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v2/publishers/{publisher}/balance
 */

v2.getBalance = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = new BigNumber(summary[0].probi.toString())

      summary = await settlements.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher }
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) probi = new BigNumber(0)

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      reply({
        rates: runtime.currency.rates[altcurrency],
        altcurrency: altcurrency,
        probi: probi.truncated().toString(),
        amount: amount,
        currency: currency
      })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets the balance for a verified publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency') }
  },

  response: {
    schema: Joi.object().keys({
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
      probi: braveJoi.string().numeric().optional().description('the balance in probi'),
      amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency')
    })
  }
}

/*
   GET /v2/publishers/{publisher}/wallet
 */

v2.getWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, entries, entry, provider, rates, result, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = new BigNumber(summary[0].probi.toString())

      summary = await settlements.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher }
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) {
        runtime.captureException(new Error('negative probi'), { extra: { publisher: publisher, probi: probi.toString() } })
        probi = new BigNumber(0)
      }

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      result = {
        rates: runtime.currency.rates[altcurrency],
        contributions: {
          amount: amount,
          currency: currency,
          altcurrency: altcurrency,
          probi: probi.truncated().toString()
        }
      }

      entries = await settlements.find({ publisher: publisher }, { sort: { timestamp: -1 }, limit: 1 })
      entry = entries && entries[0]
      if (entry) {
        result.lastSettlement = underscore.extend(underscore.pick(entry, [ 'altcurrency', 'currency' ]), {
          probi: entry.probi.toString(),
          amount: entry.amount.toString(),
          timestamp: (entry.timestamp.high_ * 1000) +
            (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
        })
      }

      entry = await publishers.findOne({ publisher: publisher })
      provider = entry && entry.provider
      try {
        if (provider && entry.parameters) result.wallet = await runtime.wallet.status(entry)
        if (result.wallet) {
          result.wallet = underscore.pick(result.wallet, [ 'provider', 'authorized', 'preferredCurrency', 'availableCurrencies' ])
          rates = result.rates

          underscore.union([ result.wallet.preferredCurrency ], result.wallet.availableCurrencies).forEach((currency) => {
            const fxrates = runtime.currency.fxrates

            if ((rates[currency]) || (!rates[fxrates.base]) || (!fxrates.rates[currency])) return

            rates[currency] = rates[fxrates.base] * fxrates.rates[currency]
          })
        }
      } catch (ex) {
        debug('status', { reason: ex.toString(), stack: ex.stack })
        runtime.captureException(ex, { req: request, extra: { publisher: publisher } })
      }
      if ((provider) && (!result.wallet)) {
        result.status = { provider: entry.provider, action: entry.parameters ? 're-authorize' : 'authorize' }
      }

      reply(result)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets information for a publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency') }
  },

  response: {
    schema: Joi.object().keys({
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      contributions: Joi.object().keys({
        amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
        currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
        altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
        probi: braveJoi.string().numeric().optional().description('the balance in probi')
      }).unknown(true).required().description('pending publisher contributions'),
      lastSettlement: Joi.object().keys({
        altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
        probi: braveJoi.string().numeric().required().description('the balance in probi'),
        currency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the deposit currency'),
        amount: braveJoi.string().numeric().optional().description('the amount in the deposit currency'),
        timestamp: Joi.number().positive().optional().description('timestamp of settlement')
      }).unknown(true).optional().description('last publisher settlement'),
      wallet: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        authorized: Joi.boolean().optional().description('publisher is authorized by provider'),
        preferredCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the preferred currency'),
        availableCurrencies: Joi.array().items(braveJoi.string().anycurrencyCode()).description('available currencies')
      }).unknown(true).optional().description('publisher wallet information'),
      status: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        action: Joi.any().allow([ 'authorize', 're-authorize' ]).required().description('requested action')
      }).unknown(true).optional().description('publisher wallet status')
    })
  }
}

/*
   PUT /v2/publishers/{publisher}/wallet
 */

v2.putWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const payload = request.payload
      const provider = payload.provider
      const verificationId = request.payload.verificationId
      const visible = payload.show_verification_status
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let entry, state

      entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      if (!entry.verified) return reply(boom.badData('not verified: ' + publisher + ' using ' + verificationId))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.omit(payload, [ 'verificationId', 'show_verification_status' ]), {
          visible: visible, verified: true, altcurrency: altcurrency, authorized: true, authority: provider
        })
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: 'publisher ' + 'https://' + publisher + ' ' +
          (payload.parameters && payload.parameters.access_token ? 'registered with' : 'unregistered from') + ' ' + provider
      })

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Sets information for a verified publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    payload: {
      verificationId: Joi.string().guid().required().description('identity of the requestor'),
      provider: Joi.string().required().description('wallet provider'),
      parameters: Joi.object().required().description('wallet parameters'),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/publishers/identity?url=...
 */

v1.identity =
{ handler: (runtime) => {
  return async (request, reply) => {
    const url = request.query.url
    const debug = braveHapi.debug(module, request)
    let result

    try {
      result = getPublisherProps(url)
      if (!result) return reply(boom.notFound())

      if (!result.publisherType) {
        result.publisher = getPublisher(url, ruleset)
        if (result.publisher) underscore.extend(result, await identity(debug, runtime, result))
      }

      reply(result)
    } catch (ex) {
      reply(boom.badData(ex.toString()))
    }
  }
},

  description: 'Returns the publisher identity associated with a URL',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    query: { url: Joi.string().uri({ scheme: /https?/ }).required().description('the URL to parse') }
  },

  response:
    { schema: Joi.object().optional().description('the publisher identity') }
}

const ruleset = [
  {
    'condition': '/^[a-z][a-z].gov$/.test(SLD)',
    'consequent': 'QLD + "." + SLD',
    'description': 'governmental sites'
  },
  {
    'condition': "TLD === 'gov' || /^go.[a-z][a-z]$/.test(TLD) || /^gov.[a-z][a-z]$/.test(TLD)",
    'consequent': 'SLD',
    'description': 'governmental sites'
  },
  {
    'condition': "SLD === 'keybase.pub'",
    'consequent': "QLD + '.' + SLD",
    'description': 'keybase users'
  },
  {
    'condition': true,
    'consequent': 'SLD',
    'description': 'the default rule'
  }
]

const identity = async (debug, runtime, result) => {
  const publishersV2 = runtime.database.get('publishersV2', debug)
  let entry

  const re = (value, entries) => {
    entries.forEach((reEntry) => {
      let regexp

      if ((entry) ||
          (underscore.intersection(reEntry.publisher.split(''),
                                [ '^', '$', '*', '+', '?', '[', '(', '{', '|' ]).length === 0)) return

      try {
        regexp = new RegExp(reEntry.publisher)
        if (regexp.test(value)) entry = reEntry
      } catch (ex) {
        debug('invalid regexp ' + reEntry.publisher + ': ' + ex.toString())
      }
    })
  }

  entry = await publishersV2.findOne({ publisher: result.publisher, facet: 'domain' })

  if (!entry) entry = await publishersV2.findOne({ publisher: result.SLD.split('.')[0], facet: 'SLD' })
  if (!entry) re(result.SLD, await publishersV2.find({ facet: 'SLD' }))

  if (!entry) entry = await publishersV2.findOne({ publisher: result.TLD, facet: 'TLD' })
  if (!entry) re(result.TLD, await publishersV2.find({ facet: 'TLD' }))

  if (!entry) return {}

  return {
    properties: underscore.omit(entry, [ '_id', 'publisher', 'timestamp' ]),
    timestamp: entry.timestamp.toString()
  }
}

/*
   GET /v1/publishers/statement
 */

v1.getStatements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL },
                                                   { authority: 'automated', summary: true }))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Generates a statement for all publishers',
  tags: [ 'api' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown()
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    })
  }
}

/*
   GET /v1/publishers/{publisher}/statement
 */

v1.getStatement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let entry

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, publisher: publisher },
                                                   request.query,
                                                   { authority: 'automated', summary: true }))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Generates a statement for a publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      starting: Joi.date().iso().optional().description('starting timestamp in ISO 8601 format'),
      ending: Joi.date().iso().optional().description('ending timestamp in ISO 8601 format')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    })
  }
}

/*
   GET /v1/publishers/{publisher}/verifications/{verificationId}
 */

v1.putToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      putToken(request, reply, runtime, null, request.params.publisher, request.params.verificationId,
               request.query.show_verification_status)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets a verification token for a publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: {
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      verificationId: Joi.string().guid().required().description('identity of the requestor')
    },
    query: {
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().keys({ token: Joi.string().hex().length(64).required().description('verification token') }) }
}

/*
   PATCH /v2/publishers/{publisher}
 */

v2.patchPublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const publisher = request.params.publisher
      const payload = request.payload
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      let entry, state

      entry = await owners.findOne({ owner: owner })
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      entry = await publishers.findOne({ owner: owner, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(payload, { authority: authority })
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Sets the authorization state for the publisher',
  tags: [ 'api' ],

  validate: {
    params: {
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().required().description('the publisher identity')
    },
    payload: {
      authorized: Joi.boolean().optional().default(false).description('authorize the publisher')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   DELETE /v1/publishers/{publisher}
 */

v1.deletePublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const debug = braveHapi.debug(module, request)
      const tokens = runtime.database.get('tokens', debug)
      let entries

      entries = await tokens.find({ publisher: publisher })
      if (entries.length === 0) return reply(boom.notFound('no such entry: ' + publisher))

      if (underscore.findWhere(entries, { verified: true })) {
        return reply(boom.badData('publisher is already verified: ' + publisher))
      }

      await tokens.remove({ publisher: publisher }, { justOne: false })
      await runtime.queue.send(debug, 'publisher-report',
                               { publisher: publisher, verified: false, visible: false })

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Deletes a non-verified publisher',
  tags: [ 'api' ],

  validate:
    { params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') } },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/publishers/{publisher}/verify
 */

v1.getToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      getToken(request, reply, runtime, null, request.params.publisher, request.query.backgroundP)
    }
  },

  description: 'Verifies a publisher',
  tags: [ 'api', 'publishers', 'deprecated' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { backgroundP: Joi.boolean().optional().default(false).description('running in the background') }
  },

  response: {
    schema: Joi.object().keys({
      status: Joi.string().valid('success', 'failure').required().description('victory is mine!'),
      verificationId: Joi.string().guid().optional().description('identity of the verified requestor')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/publishers').config(v1.bulk),
  braveHapi.routes.async().post().path('/v2/publishers/settlement').config(v2.settlement),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/balance').whitelist().config(v2.getBalance),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.getWallet),
  braveHapi.routes.async().put().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.putWallet),
  braveHapi.routes.async().path('/v1/publishers/identity').whitelist().config(v1.identity),
  braveHapi.routes.async().path('/v1/publishers/statement').whitelist().config(v1.getStatements),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/statement').whitelist().config(v1.getStatement),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verifications/{verificationId}').whitelist().config(v1.putToken),
  braveHapi.routes.async().patch().path('/v2/publishers/{publisher}').whitelist().config(v2.patchPublisher),
  braveHapi.routes.async().delete().path('/v1/publishers/{publisher}').whitelist().config(v1.deletePublisher),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verify').config(v1.getToken)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}
