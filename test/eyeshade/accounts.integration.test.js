'use strict'

import {
  serial as test
} from 'ava'
import uuid from 'uuid'
import _ from 'underscore'
import {
  insertFromSettlement,
  insertFromReferrals
} from '../../eyeshade/lib/transaction'
import Postgres from 'bat-utils/lib/runtime-postgres'
import Currency from 'bat-utils/lib/runtime-currency'
import {
  eyeshadeAgent,
  cleanPgDb,
  ok
} from '../utils'
import {
  agent
} from 'supertest'

const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const settlementId = uuid.v4().toLowerCase()
const ownerId = 'publishers#uuid:' + uuid.v4().toLowerCase()
const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})
const runtime = {
  config: {
    wallet: {
      settlementAddress: {
        'BAT': '0xdeadbeef'
      }
    }
  },
  currency: new Currency({
    currency: {
      url: process.env.BAT_RATIOS_URL,
      access_token: process.env.BAT_RATIOS_TOKEN
    }
  }),
  postgres
}

const referralSettlement = {
  probi: '10000000000000000000',
  fees: '0',
  altcurrency: 'BAT',
  _id: docId,
  type: 'referral',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId: settlementId,
  address: uuid.v4().toLowerCase(),
  amount: '10',
  currency: 'BAT'
}

const referrals = {
  probi: '10000000000000000000',
  firstId: docId,
  transactionId: uuid.v4().toLowerCase(),
  _id: {
    altcurrency: 'BAT',
    owner: ownerId,
    publisher: 'foo.com'
  }
}

const referralsBar = {
  probi: '12000000000000000000',
  firstId: docId,
  transactionId: uuid.v4().toLowerCase(),
  _id: {
    altcurrency: 'BAT',
    owner: ownerId,
    publisher: 'bar.com'
  }
}

test.afterEach(cleanPgDb(postgres))

const auth = (agent) => agent.set('Authorization', 'Bearer foobarfoobar')

test('check auth scope', async (t) => {
  t.plan(0)
  const AUTH = 'Authorization'
  const KEY = `Bearer fake`
  const unauthed = agent(process.env.BAT_EYESHADE_SERVER)
  await unauthed.get('/v1/accounts/settlements/referrals/total').expect(401)
  await unauthed.get('/v1/accounts/earnings/referral/total').expect(401)
  await unauthed.get('/v1/accounts/owner/transactions').expect(401)
  await unauthed.get('/v1/accounts/settlements/referrals/total').set(AUTH, KEY).expect(401)
  await unauthed.get('/v1/accounts/earnings/referral/total').set(AUTH, KEY).expect(401)
  await unauthed.get('/v1/accounts/owner/transactions').set(AUTH, KEY).expect(401)
})

test('check settlement totals', async t => {
  t.plan(2)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromSettlement(runtime, client, referralSettlement)
    await insertFromSettlement(runtime, client, _.assign({}, referralSettlement, {
      publisher: 'bar.com',
      amount: '12',
      probi: '12000000000000000000'
    }))
    await client.query('COMMIT')
    let type
    let body

    type = 'referrals'
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/settlements/${type}/total`).use(auth).send().expect(ok))
    t.deepEqual(body, [{
      channel: 'bar.com',
      paid: '12.000000000000000000',
      account_id: referralSettlement.owner
    }, {
      channel: 'foo.com',
      paid: '10.000000000000000000',
      account_id: referralSettlement.owner
    }])

    type = 'referrals'
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/settlements/${type}/total?order=asc`).use(auth).send().expect(ok))
    t.deepEqual(body, [{
      channel: 'foo.com',
      paid: '10.000000000000000000',
      account_id: referralSettlement.owner
    }, {
      channel: 'bar.com',
      paid: '12.000000000000000000',
      account_id: referralSettlement.owner
    }])
  } finally {
    client.release()
  }
})

test('check earnings total', async t => {
  t.plan(4)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromReferrals(runtime, client, referrals)
    await insertFromReferrals(runtime, client, referralsBar)
    await client.query('COMMIT')
    let type
    let body

    type = 'referrals'
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/earnings/${type}/total`).use(auth).send().expect(ok))
    t.deepEqual(body, [{
      channel: 'bar.com',
      earnings: '12.000000000000000000',
      account_id: ownerId
    }, {
      channel: 'foo.com',
      earnings: '10.000000000000000000',
      account_id: ownerId
    }])

    type = 'referrals'
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/earnings/${type}/total?order=asc`).use(auth).send().expect(ok))
    t.deepEqual(body, [{
      channel: 'foo.com',
      earnings: '10.000000000000000000',
      account_id: ownerId
    }, {
      channel: 'bar.com',
      earnings: '12.000000000000000000',
      account_id: ownerId
    }])
  } catch (e) {
    client.release()
    throw e
  }

  try {
    const { body } = await eyeshadeAgent.get(`/v1/accounts/${encodeURIComponent(ownerId)}/transactions`)
    t.true(body.length >= 1)
    const count = body.reduce((memo, transaction) => _.keys(transaction).reduce((memo, key) => {
      return memo + (transaction[key] == null ? 1 : 0)
    }, memo), 0)
    t.is(count, 0)
  } finally {
    client.release()
  }
})
