/*
   https://github.com/grafana/grafana/blob/master/docs/sources/plugins/developing/datasources.md
   https://github.com/grafana/simple-json-datasource
 */

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const pluralize = require('pluralize')
const underscore = require('underscore')

const braveHapi = require('bat-utils').extras.hapi
const getPublisherProps = require('bat-publisher').getPublisherProps

BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

const v1 = {}

const intervalRE = new RegExp('^([1-9][0-9]*)([smhdwMy])$')

const tsdb = { _ids: {}, series: {} }

v1.search = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)
      const tseries = runtime.database.get('tseries', debug)
      let results, x

      await updateTSDB(debug, runtime)

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

      await updateTSDB(debug, runtime)

      for (let entry of targets) {
        const target = entry.target
        const series = tsdb.series[target]
        const result = { target: target, datapoints: [] }
        let datapoints, entries, p
        let min, max
        results.push(result)
        if ((!series) || (series.timestamp < range.from)) continue

        entries = await tseries.find({
          $and: [ { series: target },
                  { timestamp: { $gte: range.from.getTime().toString() } },
                  { timestamp: { $lte: range.to.getTime().toString() } } ]
        }, { sort: { timestamp: 1 } })
        datapoints = []
        entries.forEach((entry) => { datapoints.push([ entry.count, parseInt(entry.timestamp, 10) ]) })

        min = underscore.findIndex(series.datapoints, (entry) => { return (entry[1] >= range.from) })
        if (min === -1) continue

        max = underscore.findLastIndex(series.datapoints, (entry) => { return (entry[1] <= range.to) })
        if (max === -1) continue

        // all datapoints within time range
        datapoints = series.datapoints.slice(min, max)

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

const sources = {
  publishers: {
    init: async (debug, runtime, source, seqno) => {
      if (!tsdb._ids.publishers) tsdb._ids.publishers = seqno || ''
    },

    poll: async (debug, runtime, source) => {
      const database = runtime.database2 || runtime.database
      const publishers = database.get('publishers', debug)
      const query = tsdb._ids.publishers ? { _id: { $gt: tsdb._ids.publishers } } : {}
      let entries

      query.verified = true
      entries = await publishers.find(query, { _id: true, publisher: true })
      for (let entry of entries) {
        entry.timestamp = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
        entry.seqno = entry._id
      }

      for (let entry of entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
        let series, props

        tsdb._ids.publishers = entry._id

        props = getPublisherProps(entry.publisher)
        if (!props) continue

        series = (props.publisherType ? (props.providerName + '_' + pluralize(props.providerSuffix)) : 'sites') + '_verified'
        await update(debug, runtime, source, series, entry)
      }

      debug('publishers', { message: 'done', lastId: tsdb._ids.publishers })
    }
  },

  downloads: {
    init: async (debug, runtime, source, seqno) => {
      if (!tsdb._ids.downloads) tsdb._ids.downloads = seqno || '0'
    },

    poll: async (debug, runtime, source) => {
      while (true) {
        let entries

        entries = await runtime.sql.pool.query('SELECT id, ts, referral_code, platform FROM download WHERE id > $1 ' +
                                               'ORDER BY id ASC LIMIT 1000', [ tsdb._ids.downloads ])
        if ((!entries.rows) || (!entries.rows.length)) {
          debug('downloads', { message: 'done', lastId: tsdb._ids.downloads })
          break
        }

        for (let entry of entries.rows) {
          tsdb._ids.downloads = entry.id

          entry.timestamp = new Date(entry.ts).getTime()
          entry.seqno = entry.id
          await update(debug, runtime, source, entry.referral_code.toLowerCase() + '_downloads', entry)
          await update(debug, runtime, source, entry.referral_code.toLowerCase() + '_downloads' + '_' + entry.platform, entry)
        }
      }
    }
  },

  referrals: {
    init: async (debug, runtime, source, seqno) => {
      if (!tsdb._ids.referrals) tsdb._ids.referrals = seqno || ''
    },

    poll: async (debug, runtime, source) => {
      const database = runtime.database3 || runtime.database
      const referrals = database.get('referrals', debug)
      const query = tsdb._ids.referrals ? { _id: { $gt: tsdb._ids.referrals } } : {}
      let entries

      entries = await referrals.find(query)
      for (let entry of entries) {
        entry.timestamp = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
        entry.seqno = entry._id
      }

      for (let entry of entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
        tsdb._ids.referrals = entry._id

        await update(debug, runtime, source, entry.referrer.toLowerCase() + '_referrals', entry)
      }

      debug('referrals', { message: 'done', lastId: tsdb._ids.referrals })
    }
  }
}

const initTSDB = async (debug, runtime) => {
  const tseries = runtime.database.get('tseries', debug)

  for (let source in sources) {
    let entries, last

    entries = await tseries.find({ source: source }, { sort: { timestamp: 1 } })
    for (let entry of entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
      refresh(entry.series, parseInt(entry.timestamp, 10), -(new BigNumber(entry.count.toString()).floor()))
      last = entry
    }

    if (sources[source].init) await sources[source].init(debug, runtime, source, last && last.seqno)
  }

  await updateTSDB(debug, runtime)
}

let updateP

const updateTSDB = async (debug, runtime) => {
  if (updateP) return debug('updateTSDB', { message: 'already updating' })

  updateP = true
  for (let source in sources) {
    if (sources[source].poll) await sources[source].poll(debug, runtime, source)
  }
  updateP = false
}

const refresh = (series, timestamp, count) => {
  let table

  if (!tsdb.series[series]) tsdb.series[series] = { count: 0, timestamp: 0, datapoints: [] }
  table = tsdb.series[series]
  table.count = (count < 1) ? -count : (table.count + 1)
  if (table.timestamp === timestamp) underscore.last(table.datapoints)[0] = table.count
  else {
    table.timestamp = timestamp
    table.datapoints.push([ table.count, table.timestamp ])
  }

  return table.count
}

const update = async (debug, runtime, source, series, entry) => {
  const tseries = runtime.database.get('tseries', debug)
  const timestamp = entry.timestamp
  const count = refresh(series, timestamp, 1)

  await tseries.update({ series: series, timestamp: timestamp.toString() },
                       { $set: { count: bson.Decimal128.fromString(count.toString()), source: source, seqno: entry.seqno } },
                       { upsert: true })

  return count
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/search').config(v1.search),
  braveHapi.routes.async().post().path('/query').config(v1.query),
  braveHapi.routes.async().post().path('/annotations').config(v1.annotations)
]

module.exports.initialize = async (debug, runtime) => {
  setTimeout(() => { initTSDB(debug, runtime) }, 5 * 1000)
}
