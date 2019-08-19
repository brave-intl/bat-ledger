import {
  serial as test
} from 'ava'
// import Postgres from 'bat-utils/lib/runtime-postgres'
// import Queue from 'bat-utils/lib/runtime-queue'
import { Runtime } from 'bat-utils'
import SDebug from 'sdebug'
import {
  workers
} from '../../eyeshade/workers/wallet'
import {
  freezeOldSurveyors
} from '../../eyeshade/workers/reports'
import {
  createSurveyor,
  getSurveyor,
  cleanPgDb
} from '../utils'
import {
  timeout
} from 'bat-utils/lib/extras-utils'

const votingReportWorker = workers['voting-report']
const debug = new SDebug('surveyor-test')

const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL,
  TESTING_COHORTS
} = process.env
const runtime = new Runtime({
  testingCohorts: TESTING_COHORTS ? TESTING_COHORTS.split(',') : [],
  prometheus: {
    label: 'eyeshade.workers.1',
    redis: BAT_REDIS_URL
  },
  postgres: {
    url: BAT_POSTGRES_URL
  },
  queue: BAT_REDIS_URL
})
test.afterEach.always(cleanPgDb(runtime.postgres))

test('verify frozen occurs when daily is run', async t => {
  t.plan(15)
  let body

  // FIXME sometimes hangs
  await createSurveyor()
  // just made value
  ;({ body } = await getSurveyor())
  const { surveyorId } = body
  await waitUntilPropagated(querySurveyor, surveyorId)
  // does not freeze if midnight is before creation date
  // vote on surveyor, no rejectedVotes yet
  const publisher = 'fake-publisher'
  await voteAndCheckTally(t, publisher, surveyorId, 1)
  await voteAndCheckTally(t, publisher, surveyorId, 2)
  await tryFreeze(t, 0, false, surveyorId)

  // freezes if midnight is after creation date
  await voteAndCheckTally(t, publisher, surveyorId, 3)
  await tryFreeze(t, -1, true, surveyorId)
  // property is needed
  await voteAndCheckTally(t, publisher, surveyorId, 3)
})

async function tryFreeze (t, dayShift, expectFrozen, surveyorId) {
  const { rows: beforeFrozenSurveyors } = await querySurveyor(surveyorId)
  const beforeSurveyor = beforeFrozenSurveyors[0]
  const {
    created_at: beforeCreatedAt,
    updated_at: beforeUpdatedAt
  } = beforeSurveyor
  t.is(beforeCreatedAt.toISOString(), beforeUpdatedAt.toISOString(), 'before freeze timestamps should be the same')
  await freezeOldSurveyors(debug, runtime, dayShift)
  const { rows: afterFrozenSurveyors } = await querySurveyor(surveyorId)
  const afterSurveyor = afterFrozenSurveyors[0]
  const {
    frozen,
    created_at: afterCreatedAt,
    updated_at: afterUpdatedAt
  } = afterSurveyor
  t.is(afterFrozenSurveyors.length, 1, 'only one surveyor should be returned')
  t.is(frozen, expectFrozen, 'surveyors should ' + (expectFrozen ? 'be' : 'not be') + ' frozen')
  if (expectFrozen) {
    t.not(afterCreatedAt.toISOString(), afterUpdatedAt.toISOString(), 'updated at should be different after freeze')
  }
}

function querySurveyor (surveyorId) {
  return runtime.postgres.query('select * from surveyor_groups where id = $1 limit 1;', [surveyorId])
}

function queryVotes (surveyorId) {
  return runtime.postgres.query('select * from votes where surveyor_id = $1 limit 1;', [surveyorId])
}

async function waitUntilPropagated (fn, surveyorId) {
  let finished = await fn(surveyorId)
  while (finished.rowCount !== 1) {
    await timeout(2000)
    finished = await fn(surveyorId)
  }
}

async function voteAndCheckTally (t, publisher, surveyorId, count) {
  await votingReportWorker(debug, runtime, {
    surveyorId,
    publisher
  })
  const votes = await queryVotes(surveyorId)
  t.is(votes.rowCount, 1)
  t.is(votes.rows[0].tally, count)
}
