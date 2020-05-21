const {
  serial: test
} = require('ava')
const { Runtime } = require('bat-utils')
const SDebug = require('sdebug')
const {
  workers
} = require('../../eyeshade/workers/wallet')
const {
  freezeOldSurveyors
} = require('../../eyeshade/workers/reports')
const {
  createSurveyor,
  getSurveyor,
  cleanPgDb
} = require('../utils')
const {
  timeout
} = require('bat-utils/lib/extras-utils')

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
    label: 'eyeshade.workers.1'
  },
  queue: BAT_REDIS_URL,
  cache: {
    redis: {
      url: BAT_REDIS_URL
    }
  },
  postgres: {
    url: BAT_POSTGRES_URL
  }
})
test.afterEach.always(cleanPgDb(runtime.postgres))

test('verify frozen occurs when daily is run', async t => {
  t.plan(15)

  // FIXME sometimes hangs
  await createSurveyor()
  // just made value
  const { body: body1 } = await getSurveyor()
  const { surveyorId: surveyorId1 } = body1
  await waitUntilPropagated(querySurveyor, surveyorId1)
  // does not freeze if midnight is before creation date
  // vote on surveyor, no rejectedVotes yet
  const publisher = 'fake-publisher'
  await voteAndCheckTally(t, publisher, surveyorId1, 1)
  await voteAndCheckTally(t, publisher, surveyorId1, 2)
  await tryFreeze(t, 0, false, surveyorId1)
  // freezes if midnight is after creation date
  await voteAndCheckTally(t, publisher, surveyorId1, 3)
  // use yesterday as threshold
  await tryFreeze(t, -1, true, surveyorId1)
  // property is needed
  await voteAndCheckTally(t, publisher, surveyorId1, 3)

  // create second surveyor to check that freezing does not write bad data
  await createSurveyor()
  const { body: body2 } = await getSurveyor()
  const { surveyorId: surveyorId2 } = body2
  await waitUntilPropagated(querySurveyor, surveyorId2)
  await voteAndCheckTally(t, publisher, surveyorId2, 1)
  const votes1a = await queryVotes(surveyorId1)
  await tryFreeze(t, -1, true, surveyorId2)
  const votes1b = await queryVotes(surveyorId1)
  const votes2 = await queryVotes(surveyorId2)
  t.is(votes1a.rows.length, 1)
  t.is(votes1b.rows.length, 1)
  t.is(votes2.rows.length, 1)
  // votes should not be updated between surveyors after subsequent surveyor freezes
  t.is(votes1a.rows[0].updated_at, votes1b.rows[0].updated_at)
  t.not(votes1b.rows[0].updated_at, votes2.rows[0].updated_at)
})

async function tryFreeze (t, dayShift, expect, surveyorId) {
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
  t.is(frozen, expect, 'surveyors should be frozen')
  if (expect) {
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
