/*
   https://github.com/grafana/grafana/blob/master/docs/sources/plugins/developing/datasources.md
   https://github.com/grafana/simple-json-datasource
 */

const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const braveHapi = require('bat-utils').extras.hapi

const v1 = {}

const intervalRE = new RegExp('^([1-9][0-9]*)([smhdwMy])$')

v1.search = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)
      const tseries = runtime.database.get('tseries', debug)
      let results, x

      results = await tseries.distinct('series')
      x = results.indexOf('')
      if (x !== -1) results.splice(x, 1)
      reply(results.sort())
    }
  },

/* ONLY FOR DEBUGGING
  cors: { origin: [ '*' ] },
 */

  description: 'Used by the find metric options on query tab in panels',
  tags: [ 'api', 'grafana' ],

  validate:
    { payload: Joi.object({ target: Joi.string().allow('') }).unknown(true).required() },

  response: {
    schema: Joi.array().items(Joi.alternatives().try(
      Joi.object().keys({
        text: Joi.string().required(),
        value: Joi.number().required()
      }),
      Joi.string().required()
    ))
  }
}

v1.query = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)
      const payload = request.payload
      const interval = payload.interval
      const points = payload.maxDataPoints
      const range = payload.range
      const start = range.from.getTime()
      const gte = start.toString()
      const lte = range.to.getTime().toString()
      const targets = payload.targets
      const tseries = runtime.database.get('tseries', debug)
      const results = []
      let matches, msecs

      matches = interval.match(intervalRE)
      if (!matches) return reply(boom.badImplementation('invalid interval specification'))

      msecs = {
        m: 60,
        h: 60 * 60,
        d: 60 * 60 * 24,
        w: 60 * 60 * 24 * 7,
        M: 60 * 60 * 24 * 30,
        y: 60 * 60 * 24 * 365
      }[matches[2]] || 1
      msecs *= parseInt(interval, '10') * 1000

      for (let entry of targets) {
        const target = entry.target
        const result = { target: target, datapoints: [] }
        let datapoints, entries, p

        results.push(result)

        entries = await tseries.find({
          $and: [ { series: target }, { timestamp: { $gte: gte } }, { timestamp: { $lte: lte } } ]
        }, { sort: { timestamp: 1 } })
        datapoints = []
        entries.forEach((entry) => {
          datapoints.push([ parseInt(entry.count.toString(), 10), parseInt(entry.timestamp, 10) ])
        })
        if (datapoints.count === 0) continue

        // zero or 1 datapoint
        if (datapoints.length < 2) {
          result.datapoints = datapoints
          continue
        }

        // always start with the first datapoint
        result.datapoints.push(p = underscore.first(datapoints))

        // append those at least msecs after the previous entry
        underscore.rest(datapoints).forEach((datapoint) => {
          if ((p[1] + msecs) <= datapoint[1]) result.datapoints.push(p = datapoint)
        })

        // no need to truncate
        if (result.datapoints.length <= points) continue

        // always start with the first datapoint
        result.datapoints = [ underscore.first(datapoints) ]
        if (points < 3) {
          if ((points === 2) && (datapoints.length > 1)) result.datapoints.push(underscore.last(datapoints))
          continue
        }

        // at least 3 points, so put the last datapoint at the end (when we're done)
        p = underscore.last(datapoints)
        datapoints = underscore.sample(underscore.initial(underscore.rest(datapoints)), points - 2).sort((a, b) => {
          return (a[1] - b[1])
        })

        result.datapoints = result.datapoints.concat(datapoints, [ p ])
      }

      for (let result of results) {
        let first = underscore.first(await tseries.find({ series: result.target }, { sort: { $natural: 1 }, limit: 1 }))

        if ((first) && (parseInt(first.timestamp, 10) > start)) { result.datapoints.splice(0, 0, [ 0, start ]) }
      }

      reply(results)
    }
  },

/* ONLY FOR DEBUGGING
  cors: { origin: [ '*' ] },
 */

  description: 'Returns metrics based on input',
  tags: [ 'api', 'grafana' ],

  validate: {
    payload: Joi.object({
      range: Joi.object({
        from: Joi.date().max(Joi.ref('to')).required(),
        to: Joi.date().required()
      }).unknown(true).required(),
      interval: Joi.string().regex(intervalRE).required(),
      targets: Joi.array().items(Joi.object().keys({
        refId: Joi.string(),
        target: Joi.string()
      }).unknown(true)).required(),
      format: Joi.string().valid('json').optional().default('json'),
      maxDataPoints: Joi.number().integer().positive().required()
    }).unknown(true).required()
  },

  response: {
    schema: Joi.array().items(Joi.object().keys({
      target: Joi.string(),
      datapoints: Joi.array().items(
        Joi.array().length(2).items(
          Joi.number(),
          Joi.date().timestamp('javascript')
        )
      )
    }))
  }
}

v1.annotations = {
  handler: (runtime) => {
    return async (request, reply) => {
      reply([])
    }
  },

  description: 'Returns annotations',
  tags: [ 'api', 'grafana' ],

  validate:
    { payload: Joi.object().unknown(true) },

  response:
    { schema: Joi.array().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/search').config(v1.search),
  braveHapi.routes.async().post().path('/query').config(v1.query),
  braveHapi.routes.async().post().path('/annotations').config(v1.annotations)
]
