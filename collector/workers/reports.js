// NB: this will be folded into bat-ledger/eyeshade/workers/reports eventually...

const BigNumber = require('bignumber.js')
const batPublisher = require('bat-publisher')
const bson = require('bson')
const dateformat = require('dateformat')
const json2csv = require('json2csv')
const underscore = require('underscore')

const braveExtras = require('bat-utils').extras
const braveHapi = braveExtras.hapi
const utf8ify = braveExtras.utils.utf8ify

BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

let altcurrency

const datefmt = 'yyyymmdd-HHMMss'

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
    if (runtime.database.properties.readOnly) return

    params = underscore.pick(quantum, [ 'counts', 'inputs', 'fee', 'quantum' ])
    updateP = false
    underscore.keys(params).forEach((key) => {
      if (typeof surveyor[key] === 'undefined') {
        if ((key !== 'quantum') && (key !== 'inputs') && (key !== 'fee')) {
          runtime.captureException(new Error('missing key'), { extra: { surveyorId: surveyor.surveyorId, key: key } })
        }
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
      $group: {
        _id: '$surveyorId',
        probi: { $sum: '$probi' },
        fee: { $sum: '$fee' },
        inputs: { $sum: { $subtract: [ '$probi', '$fee' ] } },
        votes: { $sum: '$votes' }
      }
    },
    {
      $project: {
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
      $group: {
        _id: '$surveyorId',
        counts: { $sum: '$counts' }
      }
    },
    {
      $project: {
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

const mixer = async (debug, runtime, filter, qid) => {
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
      if ((filter) && (filter.indexOf(slice.publisher) === -1)) continue

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
        fees: fees,
        cohort: slice.cohort || 'control'
      })
      if ((runtime.database.properties.readOnly) || (equals(slice.probi && new BigNumber(slice.probi.toString()), probi))) {
        continue
      }

      state = {
        $set: {
          altcurrency: altcurrency,
          probi: bson.Decimal128.fromString(probi.toString()),
          fees: bson.Decimal128.fromString(fees.toString())
        }
      }
      await voting.update({ surveyorId: quantum.surveyorId, publisher: slice.publisher, cohort: slice.cohort || 'control' },
                          state, { upsert: true })
    }
  }

  results = await quanta(debug, runtime, qid)
  for (let result of results) await slicer(result)
  return publishers
}

const publisherCompare = (a, b) => {
  const aProps = batPublisher.getPublisherProps(a.publisher)
  const bProps = batPublisher.getPublisherProps(b.publisher)

// cf., https://en.wikipedia.org/wiki/Robustness_principle
  if (!aProps) { return (bProps ? (-1) : 0) } else if (!bProps) { return 1 }

  if (aProps.publisherType) {
    return ((!bProps.publisherType) ? 1
            : (aProps.providerName !== b.providerName) ? (aProps.providerName - b.providerName)
            : (aProps.providerSuffix !== b.providerSuffix) ? (aProps.providerSuffix - b.providerSuffix)
            : (aProps.providerValue - bProps.providerValue))
  }

  if (bProps.publisherType) return (-1)

  return braveHapi.domainCompare(a.publisher, b.publisher)
}

const labelize = async (debug, runtime, data) => {
  const labels = {}
  const owners = runtime.database.get('owners', debug)
  const publishersC = runtime.database.get('publishers', debug)

  for (let datum of data) {
    const publisher = datum.publisher
    let entry, owner, props

    if (!publisher) continue

    if (labels[publisher]) {
      datum.publisher = labels[publisher]
      continue
    }

    props = batPublisher.getPublisherProps(publisher)
    labels[publisher] = publisher

    if (props && props.publisherType) entry = await publishersC.findOne({ publisher: publisher })
    if (entry) {
      labels[publisher] = props.URL
      if ((!entry.info) && (entry.owner)) {
        owner = await owners.findOne({ owner: entry.owner })
        if (owner) entry = owner
      }

      if (entry.info && entry.info.name) labels[publisher] = entry.info.name + ' on ' + props.providerName
    }
    datum.publisher = labels[publisher]
  }

  return data
}

const publisherContributions = (runtime, publishers, authority, authorized, verified, format, reportId, summaryP, threshold,
                              usd) => {
  const scale = new BigNumber(runtime.currency.alt2scale(altcurrency) || 1)
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
      vote['publisher USD'] = usd && vote.probi.times(usd).dividedBy(scale).toFixed(2)
      vote['processor USD'] = usd && vote.fees.times(usd).dividedBy(scale).toFixed(2)
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

        result = underscore.pick(entry, [ 'publisher', 'altcurrency', 'probi', 'fees' ])
        result.authority = authority
        result.transactionId = reportId
        result.currency = 'USD'
        result.amount = usd && new BigNumber(entry.probi).times(usd).dividedBy(scale).toFixed(2)
        result.fee = usd && new BigNumber(entry.fees).times(usd).dividedBy(scale).toFixed(2)
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
      'publisher USD': usd && new BigNumber(result.probi).times(usd).dividedBy(scale).toFixed(2),
      'processor USD': usd && new BigNumber(result.fees).times(usd).dividedBy(scale).toFixed(2),
      timestamp: lastxn && lastxn.timestamp && dateformat(lastxn.timestamp, datefmt)
    }
    if (authority) {
      underscore.extend(datum, { verified: result.verified, authorized: result.authorized })
    }
    data.push(datum)
    if (!summaryP) {
      underscore.sortBy(result.votes, 'timestamp').forEach((vote) => {
        data.push(underscore.extend({ publisher: result.publisher },
                                    underscore.omit(vote, [ 'surveyorId', 'updated', 'cohort' ]),
                                    { transactionId: vote.surveyorId, timestamp: dateformat(vote.timestamp, datefmt) }))
      })
    }
  })

  return { data: data, altcurrency: altcurrency, probi: probi, fees: fees }
}

var exports = {}

exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}

exports.workers = {
/* sent by GET /v1/reports/publishers/monthly/contributions

    { queue            : 'report-publishers-monthly-contributions'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , publisher      : '...'
      , threshold      : probi
      , amount         : '...'    // ignored (converted to threshold probi)
      , currency       : '...'    //   ..
      }
    }
 */
  'report-publishers-monthly-contributions':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const database = runtime.database2 || runtime.database
      const voting = runtime.database.get('voting', debug)
      let data, file, summary

      data = []
      summary = await voting.aggregate([ {
        '$match': {
          'counts': { '$gt': 0 },
          'altcurrency': { $eq: altcurrency },
          'exclude': false
        }
      }, {
        '$project': {
          'publisher': '$publisher',
          'cohort': '$cohort',
          '_month': { '$month': '$timestamp' },
          '_year': { '$year': '$timestamp' },
          'counts': '$counts'
        }
      }, {
        '$group': {
          '_id': { 'publisher': '$publisher', 'cohort': '$cohort', 'year': '$_year', 'month': '$_month' },
          'counts': { '$sum': '$counts' }
        }
      }])
      summary.forEach((datum) => { data.push(underscore.extend(datum._id, { counts: datum.counts })) })
      data = data.sort(publisherCompare)

      file = await database.createFile(runtime, 'publishers-', payload)
      if (format === 'json') {
        await file.write(utf8ify(data), true)
        return runtime.notify(debug, {
          channel: '#publishers-bot',
          text: authority + ' report-publishers-monthly-contributions completed'
        })
      }

      try { await file.write(utf8ify(json2csv({ data: data })), true) } catch (ex) {
        debug('reports', { report: 'report-publishers-monthly-contributions', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: authority + ' report-publishers-monthly-contributions completed'
      })
    },

/* sent by GET /v1/reports/publisher/{publisher}/contributions
           GET /v1/reports/publishers/contributions

    { queue            : 'report-publishers-collector-contributions'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , analysis       :  true  | false
      , authorized     :  true  | false | undefined
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , publisher      : '...'
      , balance        :  true  | false
      , summary        :  true  | false
      , threshold      : probi
      , verified       :  true  | false | undefined
      , amount         : '...'    // ignored (converted to threshold probi)
      , currency       : '...'    //   ..
      }
    }
 */
  'report-publishers-collector-contributions':
    async (debug, runtime, payload) => {
      const analysisP = payload.analysis
      const authority = payload.authority
      const authorized = payload.authorized
      const format = payload.format || 'csv'
      const balanceP = payload.balance
      const publisher = payload.publisher
      const reportId = payload.reportId
      const summaryP = payload.summary || analysisP
      const threshold = payload.threshold || 0
      const verified = payload.verified
      const owners = runtime.database.get('owners', debug)
      const database = runtime.database2 || runtime.database
      const pseries = database.get('pseries', debug)
      const publishersC = runtime.database.get('publishers', debug)
      const settlements = runtime.database.get('settlements', debug)
      const tokens = runtime.database.get('tokens', debug)
      const voting = runtime.database.get('voting', debug)
      const scale = new BigNumber(runtime.currency.alt2scale(altcurrency) || 1)
      let cohorts, data, entries, fields, file, info, previous, publishers, query, results, usd

      publishers = await mixer(debug, runtime, publisher && [ publisher ], undefined)

      underscore.keys(publishers).forEach((publisher) => {
        publishers[publisher].authorized = false
        publishers[publisher].verified = false
      })
      entries = await publishersC.find({ authorized: true })
      entries.forEach((entry) => {
        if (typeof publishers[entry.publisher] === 'undefined') return

        underscore.extend(publishers[entry.publisher], underscore.pick(entry, [ 'authorized', 'altcurrency', 'provider' ]))
      })
      entries = await tokens.find({ verified: true })
      entries.forEach((entry) => {
        if (typeof publishers[entry.publisher] !== 'undefined') publishers[entry.publisher].verified = true
      })

      if (balanceP) {
        previous = await settlements.aggregate([
          {
            $match: {
              probi: { $gt: 0 },
              altcurrency: { $eq: altcurrency }
            }
          },
          {
            $group: {
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

      usd = runtime.currency.alt2fiat(altcurrency, 1, 'USD', true) || new BigNumber(0)
      info = publisherContributions(runtime, publishers, authority, authorized, verified, format, reportId, summaryP,
                                    threshold, usd)
      data = info.data

      if (analysisP) {
        results = []

        query = { $or: [] }
        for (let datum of data) { query.$or.push({ publisher: datum.publisher }) }
        entries = await voting.aggregate([
          {
            $match: query
          },
          {
            $group: {
              _id: { publisher: '$publisher', cohort: '$cohort' },
              counts: { $sum: '$counts' }
            }
          },
          {
            $project: {
              _id: 1,
              counts: 1
            }
          }
        ])

        cohorts = [ 'control', 'grant' ]
        for (let entry of entries) {
          const cohort = entry._id.cohort

          if ((cohort) && (cohorts.indexOf(cohort) === -1)) cohorts.push(cohort)
        }

        for (let datum of data) {
          const notAsciiRE = /[^\x20-\x7F]+/
          let didP, plist

          datum.control = datum.grant = 0
          for (let entry of entries) {
            if (entry._id.publisher === datum.publisher) datum[entry._id.cohort || 'control'] = entry.counts
          }

          plist = await pseries.find({ publisher: datum.publisher })
          for (let entry of plist) {
            entry.timestamp = dateformat((entry.timestamp.high_ * 1000) +
                                         (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_),
                                         datefmt)
          }
          plist = plist.sort((a, b) => { return (b.timestamp - a.timestamp) })

          for (let entry of plist) {
            let params, props

            params = { timestamp: entry.timestamp }
            if (entry.reason) params.reason = entry.reason

            if (entry.site) {
              underscore.extend(params, { modified: '' }, underscore.omit(entry.site, [ 'publisher' ]))
            } else {
              underscore.extend(params, { created: '' }, entry.snippet || {}, entry.statistics || {})
              props = batPublisher.getPublisherProps(datum.publisher)
              if (props) params.url = props.URL
            }

            props = [ 'title', 'softTitle', 'description', 'text' ]
            props.forEach((prop) => {
              const value = params[prop]

              if (!value) return

              if (notAsciiRE.test(value)) params[prop] = 'non-ascii characters (length ' + value.length + ')'
              else if (value.length > 30) params[prop] = value.substr(0, 20).trim() + '... (length ' + value.length + ')'
            })

            props = [ 'created', 'modified' ]
            props.forEach((prop) => {
              const value = params[prop]

              if (!value) return

              delete params[prop]
              params.epoch = dateformat((value.high_ * 1000) + (value.low_ / bson.Timestamp.TWO_PWR_32_DBL_), datefmt)
            })

            if (didP) results.push(underscore.extend({ publisher: datum.publisher }, params))
            else didP = results.push(underscore.extend(datum, params))
          }

          if (!didP) results.push(datum)
        }

        data = results
      }

      file = await database.createFile(runtime, 'publishers-', payload)
      if (format === 'json') {
        entries = []
        for (let datum of data) {
          let entry, props, wallet

          delete datum.currency
          delete datum.amount
          delete datum.fee

          try {
            entry = await publishersC.findOne({ publisher: datum.publisher })
            if (!entry) continue

            props = batPublisher.getPublisherProps(datum.publisher)
            datum.name = entry.info && entry.info.name
            datum.URL = props && props.URL

            if (entry.provider) wallet = await runtime.wallet.status(entry)
            if ((!wallet) && (entry.owner)) {
              entry = await owners.findOne({ owner: entry.owner })
              if (entry.provider) wallet = await runtime.wallet.status(entry)
            }
            if ((wallet) && (wallet.address) && (wallet.preferredCurrency)) {
              datum.address = wallet.address
              datum.currency = wallet.preferredCurrency
            } else {
/* NOT NEEDED by collector
              await notification(debug, runtime, entry.owner, datum.publisher, { type: 'verified_no_wallet' })
 */
            }
            entries.push(datum)
          } catch (ex) {}
        }
        data = entries

        await file.write(utf8ify(entries), true)
        return runtime.notify(debug, {
          channel: '#publishers-bot',
          text: authority + ' report-publishers-collector-contributions completed'
        })
      }

      if (!publisher) {
        data.push({
          publisher: 'TOTAL',
          altcurrency: info.altcurrency,
          probi: info.probi.truncated().toString(),
          fees: info.fees.truncated().toString(),
          'publisher USD': usd && info.probi.times(usd).dividedBy(scale).toFixed(2),
          'processor USD': usd && info.fees.times(usd).dividedBy(scale).toFixed(2)
        })
      } else if (data.length === 0) {
        data.push({
          publisher: publisher,
          altcurrency: altcurrency,
          probi: 0,
          fees: 0,
          'publisher USD': 0,
          'processor USD': 0
        })
      }

      fields = [
        'publisher', 'altcurrency', 'probi', 'fees', 'publisher USD', 'processor USD', 'verified', 'authorized',
        'timestamp'
      ]
      if (cohorts) {
        fields = fields.concat(cohorts, [
          'epoch', 'title', 'softTitle', 'description', 'text', 'url',
          'comments', 'subscribers', 'videos', 'country',
          'reason'
        ])
      }
      try {
        await file.write(utf8ify(json2csv({ data: await labelize(debug, runtime, data), fields: fields })), true)
      } catch (ex) {
        debug('reports', { report: 'report-publishers-collector-contributions', reason: ex.toString() })
        console.log(ex.stack)
        file.close()
      }
      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: authority + ' report-publishers-collector-contributions completed'
      })
    }
}

module.exports = exports
