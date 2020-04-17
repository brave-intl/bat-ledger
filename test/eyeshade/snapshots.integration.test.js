import { serial as test } from 'ava'
import _ from 'underscore'
import uuidV4 from 'uuid/v4'
import {
  justDate,
  timeout
} from 'bat-utils/lib/extras-utils'
import { Runtime } from 'bat-utils'
import { insertFromSettlement } from '../../eyeshade/lib/transaction'
import {
  agents,
  ok,
  cleanPgDb
} from '../utils'

const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL,
  TESTING_COHORTS
} = process.env
const runtime = new Runtime({
  testingCohorts: TESTING_COHORTS ? TESTING_COHORTS.split(',') : [],
  queue: BAT_REDIS_URL,
  prometheus: {
    label: 'eyeshade.worker.1'
  },
  currency: {
    url: process.env.BAT_RATIOS_URL || false,
    access_token: process.env.BAT_RATIOS_TOKEN || false
  },
  postgres: {
    roURL: BAT_POSTGRES_URL,
    url: BAT_POSTGRES_URL
  }
})
const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()
const contributionSettlement = (extras) => Object.assign({
  probi: '9500000000000000000',
  fees: '500000000000000000',
  altcurrency: 'BAT',
  _id: docId,
  type: 'contribution',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId: uuidV4().toLowerCase(),
  address: uuidV4().toLowerCase(),
  amount: '9.5',
  currency: 'BAT'
}, extras)
const referralSettlement = (extras) => Object.assign({
  probi: '10000000000000000000',
  fees: '0',
  altcurrency: 'BAT',
  _id: docId,
  type: 'referral',
  publisher: 'bar.com',
  owner: ownerId,
  settlementId: uuidV4().toLowerCase(),
  address: uuidV4().toLowerCase(),
  amount: '10',
  currency: 'BAT'
}, extras)

test.afterEach.always(cleanPgDb(runtime.postgres))
test('check snapshots auth', async (t) => {
  t.plan(0)
  await createSnapshot({
    expect: 403,
    agent: agents.eyeshade.global
  })
  await createSnapshot({})
})
test('duplicate snapshots id posting conficts', async (t) => {
  t.plan(0)
  const { snapshotId } = await createSnapshot({})
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
    snapshotId
  })
  await getSnapshot({
    snapshotId,
    expect: 202
  })
  let rows = []
  while (!rows.length) {
    await timeout(1000)
    ;({ rows } = await runtime.postgres.query('select * from payout_reports where completed = true'))
  }
  await getSnapshot({
    snapshotId,
    expect: ok
  })
})
test('snapshots can receive an until value to let the worker know which transactions to consider', async (t) => {
  const client = await runtime.postgres.connect()
  const date = justDate(new Date())
  try {
    const { snapshotId } = await createSnapshot({
      until: date
    })
    const snapshot = await getSnapshot({
      snapshotId,
      expect: 202
    })
    t.deepEqual({
      id: snapshotId,
      completed: false
    }, _.pick(snapshot, ['id', 'completed']))
    const awaitedSnapshot = await waitForSnapshot({
      runtime,
      snapshotId
    })
    t.deepEqual({
      id: snapshotId,
      completed: true
    }, _.pick(awaitedSnapshot, ['id', 'completed']))

    await insertFromSettlement(runtime, client, contributionSettlement())

    await insertFromSettlement(runtime, client, referralSettlement())

    const { snapshotId: constrainedTimeSnapshotId } = await createSnapshot({
      until: (new Date('2010-01-01')).toISOString()
    })
    const constrainedTimeSnapshot = await waitForSnapshot({
      runtime,
      snapshotId: constrainedTimeSnapshotId
    })

    t.deepEqual({
      id: constrainedTimeSnapshotId,
      completed: true,
      items: []
    }, _.pick(constrainedTimeSnapshot, ['id', 'completed', 'items']))

    const { snapshotId: openTimeSnapshotId } = await createSnapshot({
      until: (new Date()).toISOString()
    })
    const openTimeSnapshot = await waitForSnapshot({
      runtime,
      snapshotId: openTimeSnapshotId
    })

    const fooBalances = await getSnapshot({
      snapshotId: snapshot.id,
      expect: ok,
      account: ['foo.com']
    })
    t.not(openTimeSnapshot.items.length, fooBalances.items.length, 'foo balances should have a filtered list')
  } catch (e) {
    console.log(e)
    throw e
  }
})

async function waitForSnapshot ({
  runtime,
  snapshotId
}) {
  let rows = []
  while (!rows.length) {
    await timeout(1000)
    ;({ rows } = await runtime.postgres.query('select * from payout_reports where completed = true and id = $1', [snapshotId]))
  }
  return getSnapshot({
    snapshotId,
    expect: ok
  })
}

async function getSnapshot ({
  snapshotId,
  agent = agents.eyeshade.publishers,
  expect = ok,
  account = []
}) {
  const id = snapshotId || uuidV4().toLowerCase()
  const url = `/v1/snapshots/${id}`
  const { body } = await agent
    .get(url)
    .query({ account })
    .expect(expect)
  return body
}

async function createSnapshot ({
  snapshotId,
  agent = agents.eyeshade.publishers,
  expect = 201,
  until
}) {
  const url = '/v1/snapshots/'
  const payload = {
    until, // undefined is omitted from json
    snapshotId: snapshotId || uuidV4().toLowerCase()
  }
  const { body } = await agent
    .post(url)
    .send(payload)
    .expect(expect)
  return body
}
