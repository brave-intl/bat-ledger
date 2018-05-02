const BigNumber = require('bignumber.js')
const bson = require('bson')
const pluralize = require('pluralize')

const getPublisherProps = require('bat-publisher').getPublisherProps

BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

const tsdb = { _ids: {}, series: {} }

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

  setTimeout(() => { updateTSDB(debug, runtime) }, 5 * 1000)
}

const refresh = (series, timestamp, count) => {
  let table

  if (!tsdb.series[series]) tsdb.series[series] = { count: 0, timestamp: 0, datapoints: [] }
  table = tsdb.series[series]
  table.count = (count < 1) ? -count : (table.count + 1)
  table.timestamp = timestamp

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

module.exports.initialize = async (debug, runtime) => {
  await initTSDB(debug, runtime)
}
