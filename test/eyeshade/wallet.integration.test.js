import {
  serial as test
} from 'ava'
import Postgres from 'bat-utils/lib/runtime-postgres'
import Queue from 'bat-utils/lib/runtime-queue'
import {
  workers
} from './wallet'
import {
  freezeOldSurveyors
} from './reports'
import {
  createSurveyor,
  getSurveyor,
  debug,
  cleanPgDb
} from 'bat-utils/test'
import {
  timeout
} from 'bat-utils/lib/extras-utils'

const config = require('../../config')
const votingReportWorker = workers['voting-report']

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
const runtime = {
  config,
  postgres,
  queue: new Queue({ queue: process.env.BAT_REDIS_URL })
}

test.after(cleanPgDb(postgres))

test('verify frozen occurs when daily is run', async t => {
  t.plan(12)
  let body

  await createSurveyor()
  // just made value
  ;({ body } = await getSurveyor())
  const { surveyorId } = body
  await waitUntilPropagated(querySurveyor)
  // does not freeze if midnight is before creation date
  // vote on surveyor, no rejectedVotes yet
  await voteAndCheckTally(1)
  await voteAndCheckTally(2)
  await tryFreeze(0, false)
  // freezes if midnight is after creation date
  await voteAndCheckTally(3)
  await tryFreeze(-1, true)
  // property is needed
  await voteAndCheckTally(3)

  async function voteAndCheckTally (count) {
    const publisher = 'fake-publisher'
    await votingReportWorker(debug, runtime, {
      surveyorId,
      publisher
    })
    const votes = await queryVotes()
    t.is(votes.rowCount, 1)
    t.is(votes.rows[0].tally, count)
  }

  async function tryFreeze (dayShift, expect) {
    await freezeOldSurveyors(debug, runtime, dayShift)
    // beware of cursor
    const surveyor = await querySurveyor()
    t.is(surveyor.rowCount, 1)
    t.is(surveyor.rows[0].frozen, expect)
  }

  function querySurveyor () {
    return postgres.query('select * from surveyor_groups where id = $1 limit 1;', [surveyorId])
  }

  function queryVotes () {
    return postgres.query('select * from votes where surveyor_id = $1 limit 1;', [surveyorId])
  }

  async function waitUntilPropagated (fn) {
    let finished = await fn()
    while (finished.rowCount !== 1) {
      await timeout(2000)
      finished = await fn()
    }
  }
})
