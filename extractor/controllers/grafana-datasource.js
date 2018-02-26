/*
   https://github.com/grafana/grafana/blob/master/docs/sources/plugins/developing/datasources.md
   https://github.com/grafana/simple-json-datasource
 */

// const BigNumber = require('bignumber.js')
const boom = require('boom')
const Joi = require('joi')
// const papertrail = require('papertrail-stream')
const pluralize = require('pluralize')
const underscore = require('underscore')

const braveExtras = require('bat-utils').extras
const braveHapi = braveExtras.hapi
const timeout = braveExtras.utils.timeout
const getPublisherProps = require('bat-publisher').getPublisherProps

const v1 = {}

const intervalRE = new RegExp('^([1-9][0-9]*)([smhdwMy])$')

const tsdb = { _ids: {}, series: {} }

v1.search = {
  handler: (runtime) => {
    return async (request, reply) => {
      const debug = braveHapi.debug(module, request)

      await updateTSDB(debug, runtime)
      reply(underscore.keys(tsdb.series).sort())
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
      tsdb._ids.publishers = seqno || ''
    },

    poll: async (debug, runtime, source, update) => {
      const database = runtime.database2 || runtime.database
      const publishers = database.get('publishers', debug)
      let entries

      entries = await publishers.find(tsdb._ids.publishers ? { _id: { $gt: tsdb._ids.publishers } } : {},
                                      { _id: true, publisher: true })
      for (let entry of entries) {
        entry.timestamp = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
        entry.seqno = entry._id
      }

      for (let entry of entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
        let key, props

        tsdb._ids.publishers = entry._id
        props = getPublisherProps(entry.publisher)
        if (!props) continue

        key = (props.publisherType ? (props.providerName + '_' + pluralize(props.providerSuffix)) : 'sites') + '_verified'
        await update(source, key, entry)
      }

      debug('publishers', { message: 'done', lastId: tsdb._ids.publishers })
    }
  },

  downloads: {
    init: async (debug, runtime, source, seqno) => {
      tsdb._ids.downloads = seqno || '0'
    },

    poll: async (debug, runtime, source, update) => {
      while (true) {
        let entries

        entries = await runtime.sql.pool.query('SELECT id, ts, referral_code, platform FROM download WHERE id > $1 ' +
                                               'ORDER BY id ASC LIMIT 1000', [ tsdb._ids.downloads ])
        if ((!entries.rows) || (!entries.rows.length)) {
          return debug('downloads', { message: 'done', lastId: tsdb._ids.downloads })
        }

        for (let entry of entries.rows) {
          tsdb._ids.downloads = entry.id

          entry.timestamp = new Date(entry.ts).getTime()
          entry.seqno = entry.id
          await update(source, entry.referral_code.toLowerCase() + '_downloads', entry)
          await update(source, entry.referral_code.toLowerCase() + '_downloads' + '_' + entry.platform, entry)
        }
      }
    }
  },

  referrals: {
/*
    init: async (debug, runtime, source, seqno, update) => {
      const query = { q: 'referral filepath: ' }
      const entries = []
      let busyP

      if ((!runtime.config.papertrail) || (!runtime.config.papertrail.accessToken)) {
        throw new Error('papertrail API token not set')
      }

      query.focus = new BigNumber(seqno || '902212759663038471').plus(1).toString()
      tsdb._ids.referrals = query.focus

      papertrail(runtime.config.papertrail.accessToken, query, false).on('data', async (data) => {
        entries.push(data)
        if (busyP) return

        busyP = true
        for (let entry of entries) {
          const referrer = entry.message.substr(query.q.length).trim().split('/')[1].toLowerCase()

          entry.timestamp = new Date(entry.generated_at).getTime()
          entry.seqno = entry.id
          await update(source, referrer + '_referrals', entry)
        }
        busyP = false
      }).on('error', (err) => {
        debug('papertrail', { diagnostic: err.toString() })
      })
    }
 */
  }
}

let updateP

const updateTSDB = async (debug, runtime) => {
/*
  const series = runtime.database.get('series', debug)
 */

  const refresh = (key, entry) => {
    let table

    if (!tsdb.series[key]) tsdb.series[key] = { count: 0, timestamp: 0, datapoints: [] }
    table = tsdb.series[key]
    table.count++
    if (table.timestamp === entry.timestamp) underscore.last(table.datapoints)[0]++
    else {
      table.timestamp = entry.timestamp
      table.datapoints.push([ table.count, table.timestamp ])
    }

    return table
  }

  const update = async (source, key, entry) => {
/*
    const table = refresh(key, entry)

    await series.update({ key: key, time: table.timestamp.toString() },
                        { $set: { count: table.count, source: source, seqno: entry.seqno } },
                        { upsert: true })
 */

    refresh(key, entry)
  }

  if (updateP) return debug('updateTSDB', { message: 'already updating' })

  updateP = true
  for (let key in sources) {
    const source = sources[key]
/*
    let entries, last
 */
    let last

    if (typeof tsdb._ids[source] === 'undefined') {
/* temporarily disable caching
      entries = await series.find({ source: key }, { sort: { $natural: 1 } })
      for (let entry of entries) {
        entry.timestamp = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
      }

      for (let entry of entries.sort((a, b) => { return (a.timestamp - b.timestamp) })) {
        refresh(entry.key, entry)
        last = entry
      }
 */

      if (source.init) await sources[key].init(debug, runtime, key, last && last.seqno, update)
    }

    if (source.poll) await source.poll(debug, runtime, key, update)
  }
  updateP = false
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/search').config(v1.search),
  braveHapi.routes.async().post().path('/query').config(v1.query),
  braveHapi.routes.async().post().path('/annotations').config(v1.annotations)
]

module.exports.initialize = async (debug, runtime) => {
  await timeout(5 * 1000)
  updateTSDB(debug, runtime)
}
