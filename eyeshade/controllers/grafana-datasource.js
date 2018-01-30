/*
   https://github.com/grafana/grafana/blob/master/docs/sources/plugins/developing/datasources.md
   https://github.com/grafana/simple-json-datasource
 */

const boom = require('boom')
const Joi = require('joi')
const pluralize = require('pluralize')
const underscore = require('underscore')

const braveHapi = require('bat-utils').extras.hapi
const getPublisherProps = require('bat-publisher').getPublisherProps

const v1 = {}

const intervalRE = new RegExp('^([1-9][0-9]*)([smhdwMy])$')

const tsdb = { _id: '', series: {} }

v1.search = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)

      await updateTSDB(debug, runtime)
      reply(underscore.keys(tsdb.series))
    }
  },

  description: 'Find Used by the find metric options on query tab in panels',
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
      const targets = payload.targets
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

      await updateTSDB(debug, runtime)
      targets.forEach((entry) => {
        const target = entry.target
        const series = tsdb.series[target]
        const result = { target: target, datapoints: [] }
        let datapoints, min, max, p

        results.push(result)
        if ((!series) || (series.timestamp < range.from)) return

        min = underscore.findIndex(series.datapoints, (entry) => { return (entry[1] >= range.from) })
        if (min === -1) return

        max = underscore.findLastIndex(series.datapoints, (entry) => { return (entry[1] <= range.to) })
        if (max === -1) return

        // all datapoints within time range
        datapoints = series.datapoints.slice(min, max)

        // zero or 1 datapoint
        if (datapoints.length < 2) {
          result.datapoints = datapoints
          return
        }

        // always start with the first datapoint
        result.datapoints.push(p = underscore.first(datapoints))

        // append those at least msecs after the previous entry
        underscore.rest(datapoints).forEach((datapoint) => {
          if ((p[1] + msecs) <= datapoint[1]) result.datapoints.push(p = datapoint)
        })

        // no need to truncate
        if (result.datapoints.length <= points) return

        // always start with the first datapoint
        result.datapoints = [ underscore.first(datapoints) ]
        if (points < 3) {
          if ((points === 2) && (datapoints.length > 1)) result.datapoints.push(underscore.last(datapoints))
          return
        }

        // at least 3 points, so put the last datapoint at the end (when we're done)
        p = underscore.last(datapoints)
        datapoints = underscore.sample(underscore.initial(underscore.rest(datapoints)), points - 2).sort((a, b) => {
          return (a[1] - b[1])
        })

        result.datapoints = result.datapoints.concat(datapoints, [ p ])
      })

      reply(results)
    }
  },

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
      format: Joi.string().valid('json').required(),
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

const id2dt = (id) => {
  return new Date(parseInt(id.toHexString().substring(0, 8), 16) * 1000).getTime()
}

const updateTSDB = async (debug, runtime) => {
  const publishers = runtime.database.get('publishers', debug)
  let entries

  entries = await publishers.find(tsdb._id ? { _id: { $gt: tsdb._id } } : { }, { _id: true, publisher: true })
  for (let offset in entries) {
    const entry = entries[offset]

    entry.timestamp = id2dt(entry._id)
  }

  for (let offset in entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
    const entry = entries[offset]
    let key, props, series

    tsdb._id = entry._id
    props = getPublisherProps(entry.publisher)
    if (!props) continue

    key = props.publisherType ? (props.providerName + '_' + pluralize(props.providerSuffix)) : 'sites'
    key += '_verified'
    if (!tsdb.series[key]) tsdb.series[key] = { count: 0, timestamp: 0, datapoints: [] }
    series = tsdb.series[key]
    series.count++
    if (series.timestamp === entry.timestamp) underscore.last(series.datapoints)[0]++
    else {
      series.timestamp = entry.timestamp
      series.datapoints.push([ series.count, series.timestamp ])
    }
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/search').config(v1.search),
  braveHapi.routes.async().post().path('/query').config(v1.query),
  braveHapi.routes.async().post().path('/annotations').config(v1.annotations)
]

module.exports.initialize = updateTSDB
