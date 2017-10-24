const BigNumber = require('bignumber.js')
const bson = require('bson')
const dateformat = require('dateformat')
const json2csv = require('json2csv')
const moment = require('moment')
const underscore = require('underscore')

const braveHapi = require('bat-utils').extras.hapi

BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

let altcurrency

const datefmt = 'yyyymmdd-HHMMss'
const datefmt2 = 'yyyymmdd-HHMMss-l'

const create = async (runtime, prefix, params) => {
  let extension, filename, options

  if (params.format === 'json') {
    options = { content_type: 'application/json' }
    extension = '.json'
  } else {
    options = { content_type: 'text/csv' }
    extension = '.csv'
  }
  filename = prefix + dateformat(underscore.now(), datefmt2) + extension
  options.metadata = { 'content-disposition': 'attachment; filename="' + filename + '"' }
  return runtime.database.file(params.reportId, 'w', options)
}

const publish = async (debug, runtime, method, publisher, endpoint, payload) => {
  const prefix = publisher ? encodeURIComponent(publisher) : ''
  let result

  result = await braveHapi.wreck[method](runtime.config.publishers.url + '/api/publishers/' + prefix + (endpoint || ''), {
    headers: {
      authorization: 'Bearer ' + runtime.config.publishers.access_token,
      'content-type': 'application/json'
    },
    payload: JSON.stringify(payload),
    useProxyP: true
  })
  if (Buffer.isBuffer(result)) result = JSON.parse(result)

  return result
}

const daily = async (debug, runtime) => {
  let midnight, now, tomorrow

  debug('daily', 'running')

  midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  midnight = Math.floor(midnight.getTime() / 1000)

  try {
    await runtime.database.purgeSince(debug, runtime, midnight * 1000)
  } catch (ex) {
    runtime.captureException(ex)
    debug('daily', JSON.stringify(ex))
  }

  now = underscore.now()
  tomorrow = new Date(now)
  tomorrow.setHours(24, 0, 0, 0)
  setTimeout(() => { daily(debug, runtime) }, tomorrow - now)
  debug('daily', 'running again ' + moment(tomorrow).fromNow())
}

const hourly = async (debug, runtime) => {
  let next, now

  debug('hourly', 'running')

  try {
    await mixer(debug, runtime, undefined, undefined)
  } catch (ex) {
    runtime.captureException(ex)
    debug('hourly', JSON.stringify(ex))
  }

  now = underscore.now()
  next = now + 60 * 60 * 1000
  setTimeout(() => { hourly(debug, runtime) }, next - now)
  debug('hourly', 'running again ' + moment(next).fromNow())
}

const hourly2 = async (debug, runtime) => {
  const history = {}
  const publishers = runtime.database.get('publishers', debug)
  const tokens = runtime.database.get('tokens', debug)
  let entries, next, now

  debug('hourly2', 'running')

  try {
    entries = await publishers.find({ visible: { $exists: false } })
    for (let entry of entries) {
      await publishers.update(entry.publisher, { $set: { visible: false } }, { upsert: true })
    }

    entries = await tokens.find()
    entries.forEach((entry) => {
      if (entry.publisher === '') return

      if (!history[entry.publisher]) history[entry.publisher] = []
      if (typeof entry.visible === 'undefined') entry.visible = false
      history[entry.publisher].push(entry)
    })

    for (let publisher of underscore.keys(history)) {
      const records = history[publisher]
      let info, results, state, visible

      try {
        results = await publish(debug, runtime, 'get', publisher)
        for (let result of results) {
          const record = underscore.findWhere(records, { verificationId: result.id })

          if (!record) continue

          visible = result.show_verification_status
          info = underscore.extend(underscore.pick(result, [ 'name', 'email' ]), {
            phone: result.phone_normalized,
            preferredCurrency: result.preferredCurrency,
            visible: visible
          })
          if (underscore.isEqual(record.info, info)) continue

          state = {
            $currentDate: { timestamp: { $type: 'timestamp' } },
            $set: { info: info }
          }
          await tokens.update({ verificationId: record.verificationId, publisher: publisher }, state, { upsert: true })

          if (!record.verified) continue

          state = {
            $currentDate: { timestamp: { $type: 'timestamp' } },
            $set: { info: underscore.omit(info, [ 'visible' ]) }
          }
          if (typeof visible !== 'undefined') state.$set.visible = visible
          await publishers.update({ publisher: publisher }, state, { upsert: true })
          if (typeof visible === 'undefined') continue

          await runtime.queue.send(debug, 'publisher-report', { publisher: publisher, visible: visible })
        }
      } catch (ex) {
        runtime.captureException(ex)
        if (ex.data) {
          delete ex.data.res
          console.log('!!! ' + JSON.stringify(underscore.keys(ex.data)))
          if (ex.data.payload) ex.data.payload = ex.data.payload.toString()
        }
        debug('hourly2', JSON.stringify(ex))
      }
    }
  } catch (ex) {
    runtime.captureException(ex)
    debug('hourly2', JSON.stringify(ex))
  }

  now = underscore.now()
  next = now + 60 * 60 * 1000
  setTimeout(() => { hourly2(debug, runtime) }, next - now)
  debug('hourly2', 'running again ' + moment(next).fromNow())
}

const quanta = async (debug, runtime, qid) => {
  const contributions = runtime.database.get('contributions', debug)
  const voting = runtime.database.get('voting', debug)
  let query, results, votes

  const dicer = async (quantum, counts) => {
    const surveyors = runtime.database.get('surveyors', debug)
    let params, state, updateP, vote
    let surveyor = await surveyors.findOne({ surveyorId: quantum._id })

    if (!surveyor) return debug('missing surveyor.surveyorId', { surveyorId: quantum._id })

    quantum.created = new Date(parseInt(surveyor._id.toHexString().substring(0, 8), 16) * 1000).getTime()
    quantum.modified = (surveyor.timestamp.high_ * 1000) + (surveyor.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)

    vote = underscore.find(votes, (entry) => { return (quantum._id === entry._id) })
    underscore.extend(quantum, { counts: vote ? vote.counts : 0 })

    params = underscore.pick(quantum, [ 'counts', 'inputs', 'fee', 'quantum' ])
    updateP = false
    underscore.keys(params).forEach((key) => {
      if (typeof surveyor[key] === 'undefined') {
        runtime.captureException(new Error('missing key'), { surveyorId: surveyor.surveyorId, key: key })
        updateP = true
        return
      }

      if (!(params[key] instanceof bson.Decimal128)
          ? (params[key] !== surveyor[key])
          : !(new BigNumber(params[key].toString()).truncated().equals(new BigNumber(surveyor[key].toString()).truncated()))) {
        updateP = true
      }
    })
    if (!updateP) return

    params.inputs = bson.Decimal128.fromString(params.inputs.toString())
    params.fee = bson.Decimal128.fromString(params.fee.toString())
    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: params }
    await surveyors.update({ surveyorId: quantum._id }, state, { upsert: true })

    surveyor = await surveyors.findOne({ surveyorId: quantum._id })
    if (surveyor) {
      quantum.modified = (surveyor.timestamp.high_ * 1000) + (surveyor.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
    }
  }

  query = {
    probi: { $gt: 0 },
    votes: { $gt: 0 },
    altcurrency: { $eq: altcurrency }
  }
  if (qid) query._id = qid
  results = await contributions.aggregate([
    {
      $match: query
    },
    {
      $group:
      {
        _id: '$surveyorId',
        probi: { $sum: '$probi' },
        fee: { $sum: '$fee' },
        inputs: { $sum: { $subtract: [ '$probi', '$fee' ] } },
        votes: { $sum: '$votes' }
      }
    },
    {
      $project:
      {
        _id: 1,
        probi: 1,
        fee: 1,
        inputs: 1,
        votes: 1,
        quantum: { $divide: [ '$inputs', '$votes' ] }
      }
    }
  ])

  query = {
    counts: { $gt: 0 },
    exclude: false
  }
  if (qid) query._id = qid
  votes = await voting.aggregate([
    {
      $match: query
    },
    {
      $group:
      {
        _id: '$surveyorId',
        counts: { $sum: '$counts' }
      }
    },
    {
      $project:
      {
        _id: 1,
        counts: 1
      }
    }
  ])

  for (let result of results) await dicer(result)

  return (underscore.map(results, (result) => {
    return underscore.extend({ surveyorId: result._id }, underscore.omit(result, [ '_id' ]))
  }))
}

const mixer = async (debug, runtime, publisher, qid) => {
  const publishers = {}
  let results

  const slicer = async (quantum) => {
    const voting = runtime.database.get('voting', debug)
    let fees, probi, query, slices, state

    // current is always defined
    const equals = (previous, current) => {
      return previous && previous.dividedBy(1e11).round().equals(current.dividedBy(1e11).round())
    }

    query = { surveyorId: quantum.surveyorId, exclude: false }
    if (qid) query._id = qid
    slices = await voting.find(query)
    for (let slice of slices) {
      probi = new BigNumber(quantum.quantum.toString()).times(slice.counts).times(0.95)
      fees = new BigNumber(quantum.quantum.toString()).times(slice.counts).minus(probi)
      if ((publisher) && (slice.publisher !== publisher)) continue

      if (!publishers[slice.publisher]) {
        publishers[slice.publisher] = {
          altcurrency: altcurrency,
          probi: new BigNumber(0),
          fees: new BigNumber(0),
          votes: []
        }
      }
      publishers[slice.publisher].probi = publishers[slice.publisher].probi.plus(probi)
      publishers[slice.publisher].fees = publishers[slice.publisher].fees.plus(fees)
      publishers[slice.publisher].votes.push({
        surveyorId: quantum.surveyorId,
        timestamp: (slice.timestamp.high_ * 1000) + (slice.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_),
        counts: slice.counts,
        altcurrency: altcurrency,
        probi: probi,
        fees: fees
      })
      if (equals(slice.probi && new BigNumber(slice.probi.toString()), probi)) continue

      state = {
        $set: {
          altcurrency: altcurrency,
          probi: bson.Decimal128.fromString(probi.toString()),
          fees: bson.Decimal128.fromString(fees.toString())
        }
      }
      await voting.update({ surveyorId: quantum.surveyorId, publisher: slice.publisher }, state, { upsert: true })
    }
  }

  results = await quanta(debug, runtime, qid)
  for (let result of results) await slicer(result)
  return publishers
}

const publisherCompare = (a, b) => {
  return braveHapi.domainCompare(a.publisher, b.publisher)
}

const publisherContributions = (runtime, publishers, authority, authorized, verified, format, reportId, summaryP, threshold,
                              usd) => {
  let data, fees, results, probi

  results = []
  underscore.keys(publishers).forEach((publisher) => {
    if ((threshold) && (publishers[publisher].probi.lessThanOrEqualTo(threshold))) return

    if ((typeof verified === 'boolean') && (publishers[publisher].verified !== verified)) return

    if ((typeof authorized === 'boolean') && (publishers[publisher].authorized !== authorized)) return

    publishers[publisher].votes = underscore.sortBy(publishers[publisher].votes, 'surveyorId')
    results.push(underscore.extend({ publisher: publisher }, publishers[publisher]))
  })

  results = results.sort(publisherCompare)
  results.forEach((result) => {
    result.probi = result.probi.truncated().toString()
    result.fees = result.fees.truncated().toString()

    result.votes.forEach((vote) => {
      vote['publisher USD'] = usd && vote.probi.times(usd).toFixed(2)
      vote['processor USD'] = usd && vote.fees.times(usd).toFixed(2)
      vote.probi = vote.probi.truncated().toString()
      vote.fees = vote.fees.truncated().toString()
    })
  })

  if (format === 'json') {
    if (summaryP) {
      publishers = []
      results.forEach((entry) => {
        let result

        if (!entry.authorized) return

        result = underscore.pick(entry, [ 'publisher', 'address', 'altcurrency', 'probi', 'fees' ])
        result.authority = authority
        result.transactionId = reportId
        result.currency = 'USD'
        result.amount = usd && new BigNumber(entry.probi).times(usd).toFixed(2)
        result.fee = usd && new BigNumber(entry.fees).times(usd).toFixed(2)
        publishers.push(result)
      })

      results = publishers
    }

    return { data: results }
  }

  probi = new BigNumber(0)
  fees = new BigNumber(0)

  data = []
  results.forEach((result) => {
    let datum, lastxn

    probi = probi.plus(result.probi)
    fees = fees.plus(result.fees)
    if (summaryP) lastxn = underscore.last(result.votes)
    datum = {
      publisher: result.publisher,
      altcurrency: result.altcurrency,
      probi: result.probi,
      fees: result.fees,
      'publisher USD': usd && new BigNumber(result.probi).times(usd).toFixed(2),
      'processor USD': usd && new BigNumber(result.fees).times(usd).toFixed(2),
      timestamp: lastxn && lastxn.timestamp && dateformat(lastxn.timestamp, datefmt)
    }
    if (authority) {
      underscore.extend(datum,
                        { verified: result.verified, address: result.address ? 'yes' : 'no', authorized: result.authorized })
    }
    data.push(datum)
    if (!summaryP) {
      underscore.sortBy(result.votes, 'timestamp').forEach((vote) => {
        data.push(underscore.extend({ publisher: result.publisher },
                                    underscore.omit(vote, [ 'surveyorId', 'updated' ]),
                                    { transactionId: vote.surveyorId, timestamp: dateformat(vote.timestamp, datefmt) }))
      })
    }
  })

  return { data: data, altcurrency: altcurrency, probi: probi, fees: fees }
}

const publisherSettlements = (runtime, entries, format, summaryP, usd) => {
  const publishers = {}

  let amount, currency, data, fees, lastxn, results, probi

  entries.forEach((entry) => {
    if (entry.publisher === '') return

    if (!publishers[entry.publisher]) {
      publishers[entry.publisher] = {
        altcurrency: altcurrency,
        probi: new BigNumber(0),
        amount: new BigNumber(0),
        fees: new BigNumber(0)
      }
      publishers[entry.publisher].txns = []
    }

    underscore.extend(entry, {
      probi: entry.probi.toString(), amount: entry.amount.toString(), fees: entry.fees.toString()
    })

    publishers[entry.publisher].probi = publishers[entry.publisher].probi.plus(new BigNumber(entry.probi))
    publishers[entry.publisher].amount = publishers[entry.publisher].amount.plus(new BigNumber(entry.amount))
    if (!entry.fees) entry.fees = 0
    publishers[entry.publisher].fees = publishers[entry.publisher].fees.plus(new BigNumber(entry.fees))
    if (typeof publishers[entry.publisher].currency === 'undefined') publishers[entry.publisher].currency = entry.currency
    else if (publishers[entry.publisher].currency !== entry.currency) publishers[entry.publisher].currency = ''
    entry.created = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
    entry.modified = (entry.timestamp.high_ * 1000) + (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
    publishers[entry.publisher].txns.push(underscore.pick(entry, [
      'altcurrency', 'probi', 'currency', 'amount', 'fees', 'settlementId', 'address', 'hash', 'created', 'modified'
    ]))
  })

  results = []
  underscore.keys(publishers).forEach((publisher) => {
    const entry = publishers[publisher]

    entry.txns = underscore.sortBy(entry.txns, 'created')
    if (summaryP) {
      lastxn = underscore.last(entry.txns)
      delete entry.txns
    }

    results.push(underscore.extend({ publisher: publisher }, entry, {
      probi: entry.probi.toString(), amount: entry.amount.toString(), fees: entry.fees.toString()
    }))
  })
  results = results.sort(publisherCompare)

  if (format === 'json') return { data: results }

  probi = new BigNumber(0)
  amount = new BigNumber(0)
  fees = new BigNumber(0)

  data = []
  results.forEach((result) => {
    probi = probi.plus(result.probi)
    amount = amount.plus(result.amount)
    fees = fees.plus(result.fees)
    if (typeof currency === 'undefined') currency = result.currency
    else if (currency !== result.currency) currency = ''
    data.push({
      publisher: result.publisher,
      altcurrency: result.altcurrency,
      probi: result.probi.toString(),
      currency: result.currency,
      amount: result.amount.toString(),
      fees: result.fees.toString(),
      timestamp: lastxn && lastxn.created && dateformat(lastxn.created, datefmt)
    })
    if (!summaryP) {
      result.txns.forEach((txn) => {
        data.push(underscore.extend({ publisher: result.publisher },
                                    underscore.omit(txn, [ 'hash', 'settlementId', 'created', 'modified' ]),
                                    { transactionId: txn.hash, timestamp: txn.created && dateformat(txn.created, datefmt) }))
      })
    }
  })

  return {
    data: data,
    altcurrency: altcurrency,
    probi: probi.toString(),
    amount: currency ? amount.toString() : '',
    currency: currency,
    fees: fees.toString()
  }
}

const date2objectId = (iso8601, ceilP) => {
  let x

  if (ceilP) {
    iso8601 = iso8601.toString()
    x = iso8601.indexOf('T00:00:00.000')
    if (x !== -1) iso8601 = iso8601.slice(0, x) + 'T23:55:59' + iso8601.slice(x + 13)
  }

  return bson.ObjectId(Math[ceilP ? 'ceil' : 'floor'](new Date(iso8601).getTime() / 1000.0).toString(16) +
                       (ceilP ? 'ffffffffffffffff' : '0000000000000000'))
}

var exports = {}

exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  if ((typeof process.env.DYNO === 'undefined') || (process.env.DYNO === 'worker.1')) {
    setTimeout(() => { daily(debug, runtime) }, 5 * 1000)
    setTimeout(() => { hourly(debug, runtime) }, 30 * 1000)
    setTimeout(() => { hourly2(debug, runtime) }, 5 * 60 * 1000)
  }
}

exports.create = create
exports.publish = publish

exports.workers = {
/* sent by GET /v1/reports/publisher/{publisher}/contributions
           GET /v1/reports/publishers/contributions

    { queue            : 'report-publishers-contributions'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authorized     :  true  | false | undefined
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , publisher      : '...'
      , balance        :  true  | false
      , summary        :  true  | false
      , threshold      : probi
      , verified       :  true  | false | undefined
      }
    }
 */
  'report-publishers-contributions':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const authorized = payload.authorized
      const format = payload.format || 'csv'
      const balanceP = payload.balance
      const publisher = payload.publisher
      const reportId = payload.reportId
      const summaryP = payload.summary
      const threshold = payload.threshold || 0
      const verified = payload.verified
      const publishersC = runtime.database.get('publishers', debug)
      const settlements = runtime.database.get('settlements', debug)
      const tokens = runtime.database.get('tokens', debug)
      let data, entries, file, info, previous, publishers, usd

      publishers = await mixer(debug, runtime, publisher, undefined)

      underscore.keys(publishers).forEach((publisher) => {
        publishers[publisher].authorized = false
        publishers[publisher].verified = false
      })
      entries = await publishersC.find({ authorized: true })
      entries.forEach((entry) => {
        if (typeof publishers[entry.publisher] === 'undefined') return

        underscore.extend(publishers[entry.publisher],
                          underscore.pick(entry, [ 'authorized', 'altcurrency', 'address', 'provider' ]))
      })
      entries = await tokens.find({ verified: true })
      entries.forEach((entry) => {
        if (typeof publishers[entry.publisher] !== 'undefined') publishers[entry.publisher].verified = true
      })

      if (balanceP) {
        previous = await settlements.aggregate([
          {
            $match:
            { probi: { $gt: 0 },
              altcurrency: { $eq: altcurrency }
            }
          },
          {
            $group:
            {
              _id: '$publisher',
              probi: { $sum: '$probi' },
              fees: { $sum: '$fees' }
            }
          }
        ])
        previous.forEach((entry) => {
          const p = publishers[entry._id]

          if (typeof p === 'undefined') return

          p.probi = p.probi.minus(new BigNumber(entry.probi.toString()))
          if (p.probi.isNegative()) {
            delete publishers[entry._id]
            return
          }

          p.fees = p.fees.minus(new BigNumber(entry.fees.toString()))
          if (p.fees.isNegative()) p.fees = new BigNumber(0)
        })
      }

      usd = runtime.currency.alt2fiat(altcurrency, 1, 'USD', true) || 0
      if (usd) usd = new BigNumber(usd.toString())
      info = publisherContributions(runtime, publishers, authority, authorized, verified, format, reportId, summaryP,
                                    threshold, usd)
      data = info.data

      file = await create(runtime, 'publishers-', payload)
      if (format === 'json') {
        await file.write(JSON.stringify(data, null, 2), true)
        return runtime.notify(debug, {
          channel: '#publishers-bot',
          text: authority + ' report-publishers-contributions completed'
        })
      }

      if (!publisher) {
        data.push({
          publisher: 'TOTAL',
          altcurrency: info.altcurrency,
          probi: info.probi.truncated().toString(),
          fees: info.fees.truncated().toString(),
          'publisher USD': usd && info.probi.times(usd).toFixed(2),
          'processor USD': usd && info.fees.times(usd).toFixed(2)
        })
      }

      try { await file.write(json2csv({ data: data }), true) } catch (ex) {
        debug('reports', { report: 'report-publishers-contributions', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-publishers-contributions completed' })
    },

/* sent by GET /v1/reports/publisher/{publisher}/settlements
           GET /v1/reports/publishers/settlements

    { queue            : 'report-publishers-settlements'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , publisher      : '...'
      , summary        :  true  | false
      }
    }
 */
  'report-publishers-settlements':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const publisher = payload.publisher
      const summaryP = payload.summary
      const settlements = runtime.database.get('settlements', debug)
      let data, entries, file, info, usd

      entries = publisher ? (await settlements.find({ publisher: publisher })) : (await settlements.find())

      usd = runtime.currency.alt2fiat(altcurrency, 1, 'USD', true) || 0
      if (usd) usd = new BigNumber(usd.toString())
      info = publisherSettlements(runtime, entries, format, summaryP, usd)
      data = info.data

      file = await create(runtime, 'publishers-settlements-', payload)
      if (format === 'json') {
        await file.write(JSON.stringify(data, null, 2), true)
        return runtime.notify(debug, {
          channel: '#publishers-bot',
          text: authority + ' report-publishers-settlements completed' })
      }

      if (!publisher) {
        data.push({
          publisher: 'TOTAL',
          altcurrency: info.altcurrency,
          probi: info.probi,
          currency: info.currency,
          amount: info.amount,
          fees: info.fees
        })
      }

      try { await file.write(json2csv({ data: data }), true) } catch (ex) {
        debug('reports', { report: 'report-publishers-settlements', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-publishers-settlements completed' })
    },

/* sent by GET /v1/publishers/{publisher}/statement
           GET /v1/reports/publishers/statements
           GET /v1/reports/publisher/{publisher}/statements
           GET /v1/reports/publishers/statements/{hash}
           GET /v2/reports/publishers/statements

    { queue            : 'report-publishers-statements'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , hash           : '...'
      , publisher      : '...'
      , rollup         :  true  | false
      , summary        :  true  | false
      , starting       : 'ISO 8601 timestamp'
      , ending         : 'ISO 8601 timestamp'
      }
    }
 */
  'report-publishers-statements':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const hash = payload.hash
      const rollupP = payload.rollup
      const starting = payload.starting
      const summaryP = payload.summary
      const publisher = payload.publisher
      const settlements = runtime.database.get('settlements', debug)
      let data, data1, data2, file, entries, publishers, query, usd
      let ending = payload.ending

      if (publisher) {
        query = { publisher: publisher }
        if ((starting) || (ending)) {
          query._id = {}
          if (starting) query._id.$gte = date2objectId(starting, false)
          if (ending) query._id.$lte = date2objectId(ending, true)
        }
        entries = await settlements.find(query)
        publishers = await mixer(debug, runtime, publisher, query._id)
      } else {
        entries = await settlements.find(hash ? { hash: hash } : {})
        if (rollupP) {
          query = { $or: [] }
          entries.forEach((entry) => { query.$or.push({ publisher: entry.publisher }) })
          entries = await settlements.find(query)
        }
        publishers = await mixer(debug, runtime, undefined, undefined)
        underscore.keys(publishers).forEach((publisher) => {
          if (underscore.where(entries, { publisher: publisher }).length === 0) delete publishers[publisher]
        })
      }

      usd = runtime.currency.alt2fiat(altcurrency, 1, 'USD', true) || 0
      if (usd) usd = new BigNumber(usd.toString())
      data = []
      data1 = { altcurrency: altcurrency, probi: new BigNumber(0), fees: new BigNumber(0) }
      data2 = { altcurrency: altcurrency, probi: new BigNumber(0), fees: new BigNumber(0) }
      underscore.keys(publishers).sort(braveHapi.domainCompare).forEach((publisher) => {
        const entry = {}
        let info

        entry[publisher] = publishers[publisher]
        info = publisherContributions(runtime, entry, undefined, undefined, undefined, 'csv', undefined, summaryP, undefined,
                                      usd)
        info.data.forEach((datum) => {
          datum.probi = datum.probi.toString()
          datum.fees = datum.fees.toString()
        })
        data = data.concat(info.data)
        data1.probi = data1.probi.plus(info.probi)
        data1.fees = data1.fees.plus(info.fees)
        if (!summaryP) data.push([])

        info = publisherSettlements(runtime, underscore.where(entries, { publisher: publisher }), 'csv', summaryP, usd)
        info.data.forEach((datum) => {
          datum.probi = datum.probi.toString()
          datum.amount = datum.amount.toString()
        })
        data = data.concat(info.data)
        data2.probi = data2.probi.plus(info.probi)
        data2.fees = data2.fees.plus(info.fees)
        data.push([])
        if (!summaryP) data.push([])
      })
      if (!publisher) {
        data.push({
          publisher: 'TOTAL',
          altcurrency: data1.altcurrency,
          probi: data1.probi.toString(),
          fees: data1.fees.toString(),
          'publisher USD': usd && data1.probi.times(usd).toFixed(2),
          'processor USD': usd && data1.fees.times(usd).toFixed(2)
        })
        if (!summaryP) data.push([])
        data.push({
          publisher: 'TOTAL',
          altcurrency: data2.altcurrency,
          probi: data2.probi.toString()
        })
      }

      file = await create(runtime, 'publishers-statements-', payload)
      try {
        await file.write(json2csv({
          data: data,
          fields: [
            'timestamp', 'publisher',
            'publisher USD', 'processor USD',
            'currency', 'amount',
            'transactionId',
            'altcurrency', 'probi', 'fees',
            'counts', 'address'
          ],
          fieldNames: [
            'timestamp', 'publisher',
            'estimated USD', 'estimated fees',
            'currency', 'amount',
            'transactionId',
            'altcurrency', 'probi', 'fees',
            'counts', 'address'
          ]
        }), true)
      } catch (ex) {
        debug('reports', { report: 'report-publishers-statements', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-publishers-statements completed' })
    },

/* sent by GET /v1/reports/publishers/status
               /v2/reports/publishers/status

    { queue            : 'report-publishers-status'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , elide          :  true  | false
      , summary        :  true  | false
      , verified       :  true  | false | undefined
      }
    }
 */
  'report-publishers-status':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const elideP = payload.elide
      const summaryP = payload.summary
      const verified = payload.verified
      const publishers = runtime.database.get('publishers', debug)
      const settlements = runtime.database.get('settlements', debug)
      const tokens = runtime.database.get('tokens', debug)
      const voting = runtime.database.get('voting', debug)
      let data, entries, f, fields, file, keys, now, results, probi, summary

      const daysago = (timestamp) => {
        return Math.round((now - timestamp) / (86400 * 1000))
      }

      now = underscore.now()
      results = {}
      entries = await tokens.find()
      entries.forEach((entry) => {
        let publisher

        publisher = entry.publisher
        if (!publisher) return

        if (!results[publisher]) results[publisher] = underscore.pick(entry, [ 'publisher', 'verified' ])
        if (entry.verified) {
          underscore.extend(results[publisher], underscore.pick(entry, [ 'verified', 'verificationId', 'token', 'reason' ]))
        }

        if (!results[publisher].history) results[publisher].history = []
        entry.created = new Date(parseInt(entry._id.toHexString().substring(0, 8), 16) * 1000).getTime()
        entry.modified = (entry.timestamp.high_ * 1000) + (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
        results[publisher].history.push(underscore.extend(underscore.omit(entry, [ 'publisher', 'timestamp', 'info' ]),
                                                          entry.info || {}))
      })
      if (typeof verified === 'boolean') {
        underscore.keys(results).forEach((publisher) => {
          if (results[publisher].verified !== verified) delete results[publisher]
        })
      }

      summary = await voting.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group:
          {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      probi = {}
      summary.forEach((entry) => { probi[entry._id] = new BigNumber(entry.probi.toString()) })
      summary = await settlements.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            altcurrency: { $eq: altcurrency }
          }
        },
        {
          $group:
          {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      summary.forEach((entry) => {
        if (typeof probi[entry._id] !== 'undefined') {
          probi[entry._id] = new BigNumber(probi[entry._id].toString()).minus(entry.probi)
        }
      })

      f = async (publisher) => {
        let datum

        results[publisher].probi = probi[publisher] || new BigNumber(0)
        results[publisher].USD = runtime.currency.alt2fiat(altcurrency, results[publisher].probi, 'USD')
        results[publisher].probi = results[publisher].probi.truncated().toString()

        if (results[publisher].history) {
          results[publisher].history = underscore.sortBy(results[publisher].history, (record) => {
            return (record.verified ? Number.POSITIVE_INFINITY : record.modified)
          })
          if (!results[publisher].verified) results[publisher].reason = underscore.last(results[publisher].history).reason
        }

        datum = await publishers.findOne({ publisher: publisher })
        if (datum) {
          datum.created = new Date(parseInt(datum._id.toHexString().substring(0, 8), 16) * 1000).getTime()
          datum.modified = (datum.timestamp.high_ * 1000) + (datum.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
          underscore.extend(results[publisher],
                            underscore.omit(datum, [ '_id', 'publisher', 'timestamp', 'verified', 'info' ]), datum.info)
        }

        if (elideP) {
          if (results[publisher].email) results[publisher].email = 'yes'
          if (results[publisher].phone) results[publisher].phone = 'yes'
          if (results[publisher].address) results[publisher].address = 'yes'
          if (results[publisher].verificationId) results[publisher].verificationId = 'yes'
          if (results[publisher].token) results[publisher].token = 'yes'
        }

        data.push(results[publisher])
      }
      data = []
      keys = underscore.keys(results)
      for (let key of keys) await f(key)
      results = data.sort(publisherCompare)

      file = await create(runtime, 'publishers-status-', payload)
      if (format === 'json') {
        await file.write(JSON.stringify(data, null, 2), true)
        return runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-publishers-status completed' })
      }

      data = []
      results.forEach((result) => {
        if (!result.created) {
          underscore.extend(result, underscore.pick(underscore.last(result.history), [ 'created', 'modified' ]))
        }
        data.push(underscore.extend(underscore.omit(result, [ 'history' ]), {
          created: dateformat(result.created, datefmt),
          modified: dateformat(result.modified, datefmt),
          daysInQueue: daysago(result.created)
        }))
        if (!summaryP) {
          result.history.forEach((record) => {
            if (elideP) {
              if (record.email) record.email = 'yes'
              if (record.phone) record.phone = 'yes'
              if (record.address) record.address = 'yes'
              if (record.verificationId) record.verificationId = 'yes'
              if (record.token) record.token = 'yes'
            }
            data.push(underscore.extend({ publisher: result.publisher }, record,
              { created: dateformat(record.created, datefmt),
                modified: dateformat(record.modified, datefmt),
                daysInQueue: daysago(record.created)
              }))
          })
        }
      })

      fields = [ 'publisher', 'USD', 'probi',
        'verified', 'authorized', 'authority',
        'name', 'email', 'phone', 'provider', 'altcurrency', 'address', 'showVerificationStatus',
        'verificationId', 'reason',
        'daysInQueue', 'created', 'modified',
        'token' ]
      try { await file.write(json2csv({ data: data, fields: fields }), true) } catch (ex) {
        debug('reports', { report: 'report-publishers-status', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-publishers-status completed' })
    },

/* sent by GET /v1/reports/surveyors-contributions

    { queue            : 'report-surveyors-contributions'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , summary        :  true  | false
      }
    }
 */
  'report-surveyors-contributions':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const summaryP = payload.summary
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let data, fields, file, previous, results, slices, publishers

      if (!summaryP) {
        previous = await settlements.aggregate([
          {
            $match:
            { probi: { $gt: 0 },
              altcurrency: { $eq: altcurrency }
            }
          },
          {
            $group:
            {
              _id: '$publisher',
              probi: { $sum: '$probi' },
              fees: { $sum: '$fees' }
            }
          }
        ])
        publishers = []
        previous.forEach((entry) => {
          publishers[entry._id] = underscore.omit(entry, [ '_id' ])
        })
      }

      data = underscore.sortBy(await quanta(debug, runtime, undefined), 'created')
      results = []
      for (let quantum of data) {
        quantum = underscore.extend(quantum, {
          probi: new BigNumber(quantum.probi.toString()).truncated().toString(),
          fee: quantum.fee.toString(),
          inputs: quantum.inputs.toString(),
          quantum: new BigNumber(quantum.quantum.toString()).truncated().toString()
        })
        results.push(quantum)
        if (summaryP) continue

        slices = await voting.find({ surveyorId: quantum.surveyorId, exclude: false })
        slices.forEach((slice) => {
          let probi

          slice.probi = new BigNumber(slice.probi.toString())
          if (publishers[slice.publisher]) {
            probi = new BigNumber(publishers[slice.publisher].probi.toString())

            if (probi.lessThan(slice.probi)) slice.probi = slice.probi.minus(probi)
            else {
              probi = probi.minus(slice.probi)
              if (probi.greaterThan(0)) publishers[slice.publisher].probi = probi
              else delete publishers[slice.publisher]

              return
            }
          }

          results.push({
            surveyorId: slice.surveyorId,
            altcurrency: slice.altcurrency,
            probi: slice.probi.truncated().toString(),
            publisher: slice.publisher,
            votes: slice.counts,
            created: new Date(parseInt(slice._id.toHexString().substring(0, 8), 16) * 1000).getTime(),
            modified: (slice.timestamp.high_ * 1000) + (slice.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
          })
        })
      }

      file = await create(runtime, 'surveyors-contributions-', payload)
      if (format === 'json') {
        await file.write(JSON.stringify(results, null, 2), true)
        return runtime.notify(debug, {
          channel: '#publishers-bot',
          text: authority + ' report-surveyors-contributions completed'
        })
      }

      results.forEach((result) => {
        underscore.extend(result,
                          { created: dateformat(result.created, datefmt), modified: dateformat(result.modified, datefmt) })
      })

      fields = [ 'surveyorId', 'probi', 'fee', 'inputs', 'quantum' ]
      if (!summaryP) fields.push('publisher')
      fields = fields.concat([ 'votes', 'created', 'modified' ])
      try { await file.write(json2csv({ data: results, fields: fields }), true) } catch (ex) {
        debug('reports', { report: 'report-surveyors-contributions', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' report-surveyors-contributions completed' })
    }
}

module.exports = exports
