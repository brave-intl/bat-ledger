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
  cleanPgDb
} from '../utils'

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
  currency: new Currency({ currency: { static: true } }),
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

test('check total settlement totals', async t => {
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
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/settlements/${type}/total`))
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
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/settlements/${type}/total?order=asc`))
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

test('check total earnings total', async t => {
  t.plan(2)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromReferrals(runtime, client, referrals)
    await insertFromReferrals(runtime, client, referralsBar)
    await client.query('COMMIT')
    let type
    let body

    type = 'referrals'
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/earnings/${type}/total`))
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
    ;({ body } = await eyeshadeAgent.get(`/v1/accounts/earnings/${type}/total?order=asc`))
    t.deepEqual(body, [{
      channel: 'foo.com',
      earnings: '10.000000000000000000',
      account_id: ownerId
    }, {
      channel: 'bar.com',
      earnings: '12.000000000000000000',
      account_id: ownerId
    }])
  } finally {
    client.release()
  }
})
