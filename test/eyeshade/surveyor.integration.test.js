import {
  serial as test
} from 'ava'
import Database from 'bat-utils/lib/runtime-database'
import SDebug from 'sdebug'
import {
  freezeOldSurveyors
} from '../../eyeshade/workers/reports'
import {
  workers
} from '../../eyeshade/workers/wallet'
import {
  connectToDb,
  createSurveyor,
  timeout,
  getSurveyor
} from '../utils'

process.env.SERVICE = 'ledger'
const config = require('../../config')

const votingReportWorker = workers['voting-report']

const debug = new SDebug('surveyor-test')
const mongo = `${process.env.BAT_MONGODB_URI}/eyeshade`

const database = new Database({
  database: {
    mongo
  }
})

const runtime = {
  database,
  config
}

test('verify frozen occurs when daily is run', async t => {
  t.plan(5)
  let body
  const eyeshade = await connectToDb('eyeshade')

  const surveyors = (surveyorsCollection) => ({
    // use this proxy because of toArray
    find: (query) => surveyorsCollection.find(query).toArray(),
    update: (where, data) => surveyorsCollection.update(where, data)
  })

  const midnight = (new Date()).setHours(0, 0, 0, 0)

  await createSurveyor()
  // just made value
  ;({ body } = await getSurveyor())
  const { surveyorId } = body
  await waitUntilPropagated(querySurveyor)
  // does not freeze if midnight is before creation date
  // vote on surveyor, no rejectedVotes yet
  await voteAndCheckRejected(0)
  await tryFreeze(0, false)
  // freezes if midnight is after creation date
  await voteAndCheckRejected(0)
  await tryFreeze(-1, true)
  // property is needed
  await voteAndCheckRejected(1)

  async function voteAndCheckRejected (count) {
    const publisher = 'fake-publisher'
    await votingReportWorker(debug, runtime, {
      surveyorId,
      publisher
    })
    const surveyor = await querySurveyor()
    t.is(surveyor.rejectedVotes, count)
  }

  async function tryFreeze (dayShift, expect) {
    const collection = eyeshade.collection('surveyors')
    const surveyorsCollection = surveyors(collection)
    await freezeOldSurveyors(dayShift, midnight, surveyorsCollection)
    // beware of cursor
    const surveyor = await querySurveyor()
    t.is(surveyor.frozen, expect)
  }

  function querySurveyor () {
    return eyeshade.collection('surveyors').findOne({
      surveyorId
    })
  }

  async function waitUntilPropagated (fn) {
    let finished = await fn()
    while (!finished) {
      await timeout(2000)
      finished = await fn()
    }
  }
})
