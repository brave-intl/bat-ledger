const BigNumber = require('bignumber.js')
const bson = require('bson')
const moment = require('moment')
const underscore = require('underscore')

const braveExtras = require('bat-utils').extras
const {
  documentOlderThan,
  createdTimestamp
} = braveExtras.utils

const freezeInterval = process.env.FREEZE_SURVEYORS_AGE_DAYS
let altcurrency

const feePercent = 0.05

const daily = async (debug, runtime) => {
  const { database } = runtime

  debug('daily', 'running')

  try {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    await database.purgeSince(debug, runtime, midnight)

    await freezeOldSurveyors(debug, runtime)
  } catch (ex) {
    runtime.captureException(ex)
    debug('daily', { reason: ex.toString(), stack: ex.stack })
  }

  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  setTimeout(() => { daily(debug, runtime) }, tomorrow - new Date())
  debug('daily', 'running again ' + moment(tomorrow).fromNow())
}

exports.freezeOldSurveyors = freezeOldSurveyors

/*
  olderThanDays: int
  anchorTime: Date
  surveyors: mongodb collection
*/
async function freezeOldSurveyors (debug, runtime, olderThanDays, anchorTime) {
  const surveyors = runtime.database.get('surveyors', debug)

  if (typeof olderThanDays === 'undefined') {
    olderThanDays = freezeInterval
  }

  if (typeof anchorTime === 'undefined') {
    anchorTime = (new Date()).setHours(0, 0, 0, 0)
  }

  // in seconds
  const where = {
    frozen: { $ne: true },
    surveyorType: 'contribution'
  }
  const data = {
    $set: {
      frozen: true
    }
  }
  const nonFrozenSurveyors = await surveyors.find(where)
  const updates = nonFrozenSurveyors.map(freezeSurveyor)
  await Promise.all(updates).then(() => updates.length)

  async function freezeSurveyor (surveyor) {
    const { _id, surveyorId } = surveyor
    if (documentOlderThan(olderThanDays, anchorTime, _id)) {
      await surveyors.update({ _id }, data)
      await runtime.queue.send(debug, 'surveyor-frozen-report', { surveyorId, mix: true, shouldUpdateBalances: true })
    }
  }
}

const hourly = async (debug, runtime) => {
  let next, now

  debug('hourly', 'running')

  try {
    await mixer(debug, runtime, undefined, undefined)
  } catch (ex) {
    runtime.captureException(ex)
    debug('hourly', { reason: ex.toString(), stack: ex.stack })
  }

  now = underscore.now()
  next = now + 60 * 60 * 1000
  setTimeout(() => { hourly(debug, runtime) }, next - now)
  debug('hourly', 'running again ' + moment(next).fromNow())
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

    quantum.created = createdTimestamp(surveyor._id)
    quantum.modified = (surveyor.timestamp.high_ * 1000) + (surveyor.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)

    vote = underscore.find(votes, (entry) => { return (quantum._id === entry._id) })
    underscore.extend(quantum, { counts: vote ? vote.counts : 0 })

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
  const results = await quanta(debug, runtime, qid)
  for (let result of results) {
    await slicer(result)
  }
  return publishers

    // current is always defined
  function equals (previous, current) {
    return previous && previous.dividedBy(1e11).round().equals(current.dividedBy(1e11).round())
  }

  async function slicer ({
    quantum,
    surveyorId
  }) {
    const { database } = runtime
    const { fromString } = bson.Decimal128

    const voting = database.get('voting', debug)
    const surveyors = database.get('surveyors', debug)

    // Treat voting documents with a missing surveyor document as if they are not yet frozen
    let notYetFrozen = true
    const surveyor = await surveyors.findOne({ surveyorId })
    if (surveyor) {
      const { frozen } = surveyor
      notYetFrozen = !frozen
    } else {
      runtime.captureException(new Error('no surveyor document matching surveyorId from voting document'), { extra: { surveyorId } })
    }

    let query = { surveyorId, exclude: false }
    if (qid) query._id = qid
    let slices = await voting.find(query)
    for (let slice of slices) {
      let pub
      let where
      let fees
      let sumProbi
      let backupProbi
      let backupFees
      let quantumCounts
      let {
        counts,
        publisher,
        timestamp,
        probi,
        cohort = 'control'
      } = slice
      quantumCounts = new BigNumber(quantum.toString()).times(counts)
      fees = quantumCounts.times(feePercent)
      sumProbi = quantumCounts.minus(fees)
      backupFees = fees
      backupProbi = sumProbi
      if (filter && filter.indexOf(publisher) === -1) {
        continue
      }

      pub = publishers[publisher]
      if (!pub) {
        pub = {
          altcurrency: altcurrency,
          probi: new BigNumber(0),
          fees: new BigNumber(0),
          votes: []
        }
        publishers[publisher] = pub
      }
      if (notYetFrozen) {
        sumProbi = new BigNumber(0)
        fees = new BigNumber(0)
      }
      pub.probi = pub.probi.plus(sumProbi)
      pub.fees = pub.fees.plus(fees)
      pub.votes.push({
        timestamp: (timestamp.high_ * 1000) + (timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_),
        probi: sumProbi,
        surveyorId,
        counts,
        altcurrency,
        fees,
        cohort
      })

      let isEqual = equals(probi && new BigNumber(probi.toString()), sumProbi)
      let state = {}
      if (isEqual) {
        continue
      } else if (notYetFrozen) {
        state.$unset = {
          altcurrency,
          fees: null,
          probi: null
        }
      } else {
        state.$set = {
          altcurrency,
          probi: fromString(backupProbi.toString()),
          fees: fromString(backupFees.toString())
        }
      }

      where = {
        surveyorId,
        publisher,
        cohort
      }
      await voting.update(where, state, { upsert: true })
    }
  }
}

exports.mixer = mixer

exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  if (typeof freezeInterval === 'undefined' || isNaN(parseFloat(freezeInterval))) {
    throw new Error('FREEZE_SURVEYORS_AGE_DAYS is not set or not numeric')
  }

  if ((typeof process.env.DYNO === 'undefined') || (process.env.DYNO === 'worker.1')) {
    setTimeout(() => { daily(debug, runtime) }, 5 * 1000)
    setTimeout(() => { hourly(debug, runtime) }, 30 * 1000)
  }
}
