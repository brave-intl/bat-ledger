import { serial as test } from 'ava'
import uuidV4 from 'uuid/v4'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import { Runtime } from 'bat-utils'
// import BigNumber from 'bignumber.js'
// import {
//   insertFromSettlement
// } from '../../eyeshade/lib/transaction'
// import { workers as walletWorkers } from '../../eyeshade/workers/wallet'
// import { freezeOldSurveyors } from '../../eyeshade/workers/reports'
import {
  // debug,
  agents,
  ok,
  cleanPgDb
} from '../utils'
// import { TimeoutError } from 'bluebird'

const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL,
  // BAT_RATIOS_URL,
  // BAT_RATIOS_TOKEN,
  TESTING_COHORTS
} = process.env

// const today = new Date('2018-07-30')
const runtime = new Runtime({
  testingCohorts: TESTING_COHORTS ? TESTING_COHORTS.split(',') : [],
  queue: BAT_REDIS_URL,
  prometheus: {
    label: 'eyeshade.worker.1'
  },
  postgres: {
    url: BAT_POSTGRES_URL
  }
})

test.afterEach.always(cleanPgDb(runtime.postgres))

test('check snapshots auth', async (t) => {
  t.plan(0)
  await createSnapshot({
    expect: 403,
    agent: agents.eyeshade.global
  })
  await createSnapshot({
    expect: ok
  })
})
test('duplicate snapshots id posting conficts', async (t) => {
  t.plan(0)
  const { snapshotId } = await createSnapshot({
    expect: ok
  })
  await createSnapshot({
    snapshotId,
    expect: 409
  })
})
test('snapshots getting statuses', async (t) => {
  t.plan(0)
  const snapshotId = uuidV4().toLowerCase()
  await getSnapshot({
    snapshotId,
    expect: 404
  })
  await createSnapshot({
    snapshotId,
    expect: ok
  })
  await getSnapshot({
    snapshotId,
    expect: 202
  })
  let rows = []
  while (!rows.length) {
    await timeout(1000)
    ;({ rows } = await runtime.postgres.query('select * from balance_snapshots where completed = true'))
  }
  console.log(rows)
  await getSnapshot({
    snapshotId,
    expect: ok
  })
})

async function getSnapshot ({
  snapshotId,
  agent = agents.eyeshade.publishers,
  expect = ok
}) {
  const id = snapshotId || uuidV4().toLowerCase()
  const url = `/v1/snapshots/${id}`
  const { body } = await agent
    .get(url)
    .expect(expect)
  return body
}

async function createSnapshot ({
  snapshotId,
  agent = agents.eyeshade.publishers,
  expect = ok
}) {
  const url = '/v1/snapshots/'
  const payload = {
    snapshotId: snapshotId || uuidV4().toLowerCase()
  }
  const { body } = await agent
    .post(url)
    .send(payload)
    .expect(expect)
  return body
}
