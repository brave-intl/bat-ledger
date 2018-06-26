import {
  serial as test
} from 'ava'
import Database from 'bat-utils/lib/runtime-database'
import SDebug from 'sdebug'
import {
  workers
} from '../../eyeshade/workers/wallet'
import {
  connectToDb,
  createSurveyor,
  dbUri,
  getSurveyor,
  freezeSurveyors
} from '../utils'
import {
  timeout
} from 'bat-utils/lib/extras-utils'

process.env.SERVICE = 'ledger'
const config = require('../../config')

const votingReportWorker = workers['voting-report']

const debug = new SDebug('surveyor-test')
const mongo = dbUri('eyeshade')

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
  t.plan(6)
  let body
  const eyeshade = await connectToDb('eyeshade')

  await createSurveyor()
  // just made value
  ;({ body } = await getSurveyor())
  const { surveyorId } = body
  await t.throws(freezeSurveyors(null), Error)
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
    await freezeSurveyors(dayShift)
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
