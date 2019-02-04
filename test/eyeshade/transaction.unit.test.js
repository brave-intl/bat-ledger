'use strict'

import { serial as test } from 'ava'

import { createdTimestamp } from 'bat-utils/lib/extras-utils'
import Postgres from 'bat-utils/lib/runtime-postgres'
import Currency from 'bat-utils/lib/runtime-currency'
import { insertFromSettlement, insertFromReferrals, insertFromVoting, updateBalances } from '../../eyeshade/lib/transaction'
import uuid from 'uuid'
import _ from 'underscore'

import {
  cleanPgDb
} from '../utils'

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })

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

test.afterEach(cleanPgDb(postgres))

const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const settlementId = uuid.v4().toLowerCase()
const ownerId = 'publishers#uuid:' + uuid.v4().toLowerCase()

const contributionSettlement = {
  probi: '9500000000000000000',
  fees: '500000000000000000',
  altcurrency: 'BAT',
  _id: docId,
  type: 'contribution',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId: settlementId,
  address: uuid.v4().toLowerCase(),
  amount: '9.5',
  currency: 'BAT'
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

test('contribution settlement transaction', async t => {
  t.plan(12)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromSettlement(runtime, client, contributionSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 3)
    // first the contribution enters the owner account
    t.true(txns.rows[0].transaction_type === 'contribution')
    // next fees are removed
    t.true(txns.rows[1].transaction_type === 'fees')
    // finally payout to uphold occurs
    t.true(txns.rows[2].transaction_type === 'contribution_settlement')

    await updateBalances(runtime, client)

    const upholdBalance = await client.query(`select * from account_balances where account_type = 'uphold';`)
    t.true(upholdBalance.rows.length === 1)
    t.true(Number(upholdBalance.rows[0].balance) === 9.5)

    const ownerBalance = await client.query(`select * from account_balances where account_type = 'owner';`)
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)

    const channelBalance = await client.query(`select * from account_balances where account_type = 'channel';`)
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === -10.0)

    const feesBalance = await client.query(`select * from account_balances where account_type = 'internal';`)
    t.true(feesBalance.rows.length === 1)
    t.true(Number(feesBalance.rows[0].balance) === 0.5)
  } finally {
    client.release()
  }
})

test('referral settlement transaction', async t => {
  t.plan(6)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromSettlement(runtime, client, referralSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 1)
    // payout to uphold occurs
    t.true(txns.rows[0].transaction_type === 'referral_settlement')

    await updateBalances(runtime, client)

    const upholdBalance = await client.query(`select * from account_balances where account_type = 'uphold';`)
    t.true(upholdBalance.rows.length === 1)
    t.true(Number(upholdBalance.rows[0].balance) === 10.0)

    const ownerBalance = await client.query(`select * from account_balances where account_type = 'owner';`)
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === -10.0)
  } finally {
    client.release()
  }
})

test('settlement transaction throws on invalid altcurrency', async t => {
  t.plan(1)
  const client = await runtime.postgres.connect()
  try {
    const settlement = _.clone(contributionSettlement)
    settlement.altcurrency = 'ETH'
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement))
  } finally {
    client.release()
  }
})

test('settlement transaction throws on missing probi', async t => {
  t.plan(1)
  const client = await runtime.postgres.connect()
  try {
    const settlement = _.clone(contributionSettlement)
    delete settlement.probi
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement))
  } finally {
    client.release()
  }
})

test('settlement transaction throws on 0 probi', async t => {
  t.plan(1)
  const client = await runtime.postgres.connect()
  try {
    const settlement = _.clone(contributionSettlement)
    settlement.probi = '0'
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement))
  } finally {
    client.release()
  }
})

test('settlement transaction throws on negative probi', async t => {
  t.plan(1)
  const client = await runtime.postgres.connect()
  try {
    const settlement = _.clone(contributionSettlement)
    settlement.probi = '-1'
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement))
  } finally {
    client.release()
  }
})

test('settlement transaction throws on missing owner', async t => {
  t.plan(1)
  const client = await runtime.postgres.connect()
  try {
    const settlement = _.clone(contributionSettlement)
    delete settlement.owner
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement))
  } finally {
    client.release()
  }
})

const voting = {
  amount: '9.5',
  fees: '0.5',
  surveyorId: uuid.v4().toLowerCase(),
  channel: 'foo.com'
}

test('voting transaction', async t => {
  t.plan(6)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromVoting(runtime, client, voting, new Date(createdTimestamp(docId)).toISOString())
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 1)
  // payout to uphold occurs
    t.true(txns.rows[0].transaction_type === 'contribution')

    await updateBalances(runtime, client)

    const settlementBalance = await client.query(`select * from account_balances where account_type = 'uphold';`)
    t.true(settlementBalance.rows.length === 1)
    t.true(Number(settlementBalance.rows[0].balance) === -10.0)

    const channelBalance = await client.query(`select * from account_balances where account_type = 'channel';`)
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === 10.0)
  } finally {
    client.release()
  }
})

test('voting and contribution settlement transaction', async t => {
  t.plan(5)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromVoting(runtime, client, voting, new Date(createdTimestamp(docId)).toISOString())
    await insertFromSettlement(runtime, client, contributionSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')
    t.true(txns.rows.length === 4)

    await updateBalances(runtime, client)

    const channelBalance = await client.query(`select * from account_balances where account_type = 'channel';`)
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === 0.0)

    const ownerBalance = await client.query(`select * from account_balances where account_type = 'owner';`)
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)
  } finally {
    client.release()
  }
})

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

test('referral transaction', async t => {
  t.plan(4)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromReferrals(runtime, client, referrals)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 1)
    // payout to uphold occurs
    t.true(txns.rows[0].transaction_type === 'referral')

    await updateBalances(runtime, client)

    const ownerBalance = await client.query(`select * from account_balances where account_type = 'owner';`)
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 10.0)
  } finally {
    client.release()
  }
})

test('referral and referral settlement transaction', async t => {
  t.plan(3)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromReferrals(runtime, client, referrals)
    await insertFromSettlement(runtime, client, referralSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')
    t.true(txns.rows.length === 2)

    await updateBalances(runtime, client)

    const ownerBalance = await client.query(`select * from account_balances where account_type = 'owner';`)
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)
  } finally {
    client.release()
  }
})
