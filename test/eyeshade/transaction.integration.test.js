'use strict'

const { serial: test } = require('ava')
const { v4: uuidV4 } = require('uuid')
const {
  PROBI_FACTOR,
  BigNumber,
  createdTimestamp
} = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')
const {
  allSettlementStats,
  settlementStatsByCurrency,
  knownChains,
  insertTransaction,
  insertUserDepositFromChain,
  insertFromSettlement,
  insertFromReferrals,
  insertFromVoting,
  insertMany
} = require('../../eyeshade/lib/transaction')
const _ = require('underscore')

const {
  cleanEyeshadePgDb
} = require('../utils')

const runtime = new Runtime({
  wallet: {
    settlementAddress: {
      BAT: '0xdeadbeef'
    }
  },
  currency: {
    url: process.env.BAT_RATIOS_URL,
    access_token: process.env.BAT_RATIOS_TOKEN
  },
  postgres: {
    connectionString: process.env.BAT_POSTGRES_URL
  },
  cache: {
    redis: {
      url: process.env.BAT_REDIS_URL
    }
  },
  prometheus: {
    label: 'eyeshade.worker.1'
  }
})

test.beforeEach(cleanEyeshadePgDb.bind(null, runtime.postgres))

const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const settlementId = uuidV4().toLowerCase()
const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()

const contributionSettlement = {
  probi: '9500000000000000000',
  fees: '500000000000000000',
  altcurrency: 'BAT',
  _id: docId,
  type: 'contribution',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId,
  address: uuidV4().toLowerCase(),
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
  settlementId,
  address: uuidV4().toLowerCase(),
  amount: '10',
  currency: 'BAT'
}

test('contribution settlement transaction', async t => {
  t.plan(12)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromSettlement(runtime, null, contributionSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 3)
    // first the contribution enters the owner account
    t.true(txns.rows[0].transaction_type === 'contribution')
    // next fees are removed
    t.true(txns.rows[1].transaction_type === 'fees')
    // finally payout to uphold occurs
    t.true(txns.rows[2].transaction_type === 'contribution_settlement')

    const upholdBalance = await client.query('select * from account_balances where account_type = \'uphold\';')
    t.true(upholdBalance.rows.length === 1)
    t.true(Number(upholdBalance.rows[0].balance) === 9.5)

    const ownerBalance = await client.query('select * from account_balances where account_type = \'owner\';')
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)

    const channelBalance = await client.query('select * from account_balances where account_type = \'channel\';')
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === -10.0)

    const feesBalance = await client.query('select * from account_balances where account_type = \'internal\';')
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

    const upholdBalance = await client.query('select * from account_balances where account_type = \'uphold\';')
    t.true(upholdBalance.rows.length === 1)
    t.true(Number(upholdBalance.rows[0].balance) === 10.0)

    const ownerBalance = await client.query('select * from account_balances where account_type = \'owner\';')
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
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement), { instanceOf: Error })
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
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement), { instanceOf: Error })
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
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement), { instanceOf: Error })
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
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement), { instanceOf: Error })
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
    await t.throwsAsync(insertFromSettlement(runtime, client, settlement), { instanceOf: Error })
  } finally {
    client.release()
  }
})

const voting = () => ({
  amount: '9.5',
  fees: '0.5',
  surveyorId: uuidV4().toLowerCase(),
  channel: 'foo.com'
})

test('voting transaction', async t => {
  t.plan(6)

  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromVoting(runtime, client, voting(), new Date(createdTimestamp(docId)).toISOString())
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.true(txns.rows.length === 1)
    // payout to uphold occurs
    t.true(txns.rows[0].transaction_type === 'contribution')

    const settlementBalance = await client.query('select * from account_balances where account_type = \'uphold\';')
    t.true(settlementBalance.rows.length === 1)
    t.true(Number(settlementBalance.rows[0].balance) === -10.0)

    const channelBalance = await client.query('select * from account_balances where account_type = \'channel\';')
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
    await insertFromVoting(runtime, client, voting(), new Date(createdTimestamp(docId)).toISOString())
    await insertFromSettlement(runtime, client, contributionSettlement)
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')
    t.true(txns.rows.length === 4)

    const channelBalance = await client.query('select * from account_balances where account_type = \'channel\';')
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === 0.0)

    const ownerBalance = await client.query('select * from account_balances where account_type = \'owner\';')
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)
  } finally {
    client.release()
  }
})

const referrals = {
  probi: '10000000000000000000',
  firstId: docId,
  transactionId: uuidV4().toLowerCase(),
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

    const ownerBalance = await client.query('select * from account_balances where account_type = \'owner\';')
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

    const ownerBalance = await client.query('select * from account_balances where account_type = \'owner\';')
    t.true(ownerBalance.rows.length === 1)
    t.true(Number(ownerBalance.rows[0].balance) === 0.0)
  } finally {
    client.release()
  }
})

test('can add transactions for different account types', async (t) => {
  t.plan(6)

  const client = await runtime.postgres.connect()
  await t.throwsAsync(insertUserDepositFromChain(runtime, client), { instanceOf: Error }, 'amount is required')
  await t.throwsAsync(insertUserDepositFromChain(runtime, client, {
    amount: {}
  }), { instanceOf: Error }, 'amount goes through bignumber')
  const fakeAddress = '0xbloop'
  await insertUserDepositFromChain(runtime, client, {
    amount: '0'
  })
  const { rows: noValueTransferred } = await runtime.postgres.query('select * from transactions')
  t.deepEqual([], noValueTransferred, 'when no value is transferred, we skip inserting the tx')
  const knownChainKeys = _.keys(knownChains)
  for (let i = 0; i < knownChainKeys.length; i += 1) {
    const ticker = knownChainKeys[i]
    const chain = knownChains[ticker]
    const createdAt = new Date()
    const id = uuidV4().toLowerCase()
    const cardId = uuidV4()
    const type = (Math.random() < (1 / 3)) ? 'transfer' : (Math.random() < 0.5 ? 'deposit' : 'withdrawal')
    const inputs = {
      // should be the transaction id from the chain
      id,
      type,
      amount: 1,
      chain,
      cardId,
      createdAt,
      address: fakeAddress
    }
    await insertUserDepositFromChain(runtime, client, inputs)
    const { rows: txs } = await runtime.postgres.query(`select * from transactions where transaction_type = 'user_deposit' and description = 'deposits from ${chain} chain'`)
    const expectedResults = [{
      created_at: createdAt,
      description: `deposits from ${chain} chain`,
      transaction_type: 'user_deposit',
      document_id: id,
      from_account: fakeAddress,
      from_account_type: chain,
      to_account: cardId,
      to_account_type: 'uphold',
      amount: '1.000000000000000000',
      settlement_amount: null,
      channel: null,
      settlement_currency: null
    }]
    const subResults = txs.map((row) => _.omit(row, ['id', 'inserted_at']))
    t.deepEqual(expectedResults, subResults, `chain ${chain} is a valid from_account type`)
  }
  await client.release()
})

test('common insertion fn', async (t) => {
  t.plan(2)
  const id = uuidV4()
  const createdAt = new Date()
  const description = 'a known description'
  const transactionType = 'contribution'
  const documentId = uuidV4()
  const fromAccount = uuidV4()
  const fromAccountType = 'uphold'
  const toAccount = uuidV4()
  const toAccountType = 'uphold'
  const amount = '1.000000000000000000'
  const inputs = {
    id,
    createdAt: createdAt / 1000,
    description,
    transactionType,
    documentId,
    fromAccount,
    fromAccountType,
    toAccount,
    toAccountType,
    amount
  }
  await insertTransaction(runtime, null, inputs)
  const { rows: txs } = await runtime.postgres.query('select * from transactions')
  const zeroAmount = Object.assign({}, inputs, { amount: '0' })
  await insertTransaction(runtime, null, zeroAmount)
  const negativeAmount = Object.assign({}, inputs, { amount: '-1' })
  await insertTransaction(runtime, null, negativeAmount)
  const noAmount = Object.assign({}, inputs, { amount: null })
  await t.throwsAsync(() => insertTransaction(runtime, null, noAmount), { instanceOf: Error })
  const expectedResults = [{
    id,
    amount,
    created_at: createdAt,
    inserted_at: txs[0].inserted_at,
    description,
    transaction_type: transactionType,
    document_id: documentId,
    from_account: fromAccount,
    from_account_type: fromAccountType,
    to_account: toAccount,
    to_account_type: toAccountType,
    channel: null,
    settlement_amount: null,
    settlement_currency: null
  }]
  t.deepEqual(expectedResults, txs, 'transactions are inserted')
})

test('transaction stats', async (t) => {
  const client = await runtime.postgres.connect()
  const today = new Date('2018-07-30')
  const tomorrow = new Date('2018-07-31')
  try {
    await insertFromSettlement(runtime, client, contributionSettlement)
    await insertFromSettlement(runtime, client, Object.assign({}, contributionSettlement, {
      settlementId: uuidV4()
    }))
    const contributionStats = await settlementStatsByCurrency(runtime, {
      type: 'contribution_settlement',
      settlementCurrency: 'BAT',
      start: today,
      until: tomorrow
    })
    t.is(19, +contributionStats.amount, 'contributions are summed')

    const referralAmount = (new BigNumber(referralSettlement.probi)).dividedBy(PROBI_FACTOR)
    await insertFromSettlement(runtime, client, referralSettlement)
    await insertFromSettlement(runtime, client, Object.assign({}, referralSettlement, {
      settlementId: uuidV4()
    }))
    let referralStats = null
    referralStats = await settlementStatsByCurrency(runtime, {
      type: 'referral_settlement',
      settlementCurrency: 'BAT',
      start: today,
      until: tomorrow
    })
    const twoReferrals = referralAmount.times(2).toNumber() // 20
    t.is(twoReferrals, +referralStats.amount, 'referrals are summed')

    // await insertFromSettlement(runtime, client, referralSettlement)
    await insertFromSettlement(runtime, client, Object.assign({}, referralSettlement, {
      settlementId: uuidV4(),
      currency: 'BTC',
      amount: '0.000125'
    }))
    referralStats = await allSettlementStats(runtime, {
      type: 'referral_settlement',
      start: today,
      until: tomorrow
    })
    const threeReferrals = referralAmount.times(3).toNumber() // 30
    t.is(threeReferrals, +referralStats.amount, 'referrals are summed')

    referralStats = await settlementStatsByCurrency(runtime, {
      type: 'referral_settlement',
      settlementCurrency: 'BTC',
      start: today,
      until: tomorrow
    })
    t.is(referralAmount.toNumber(), +referralStats.amount, 'referrals are summed')
  } finally {
    client.release()
  }
})

test('insert from many voting transaction', async t => {
  t.plan(6)

  const client = await runtime.postgres.connect()
  const txs = 51
  try {
    await client.query('BEGIN')
    await insertMany.fromVoting(25, runtime, client, [...new Array(txs)].map(voting), new Date(createdTimestamp(docId)).toISOString())
    await client.query('COMMIT')

    const txns = await client.query('select * from transactions order by created_at;')

    t.is(txs, txns.rows.length)
    // payout to uphold occurs
    t.true(txns.rows[0].transaction_type === 'contribution')

    const settlementBalance = await client.query('select * from account_balances where account_type = \'uphold\';')
    t.true(settlementBalance.rows.length === 1)
    t.true(Number(settlementBalance.rows[0].balance) === -10.0 * txs)

    const channelBalance = await client.query('select * from account_balances where account_type = \'channel\';')
    t.true(channelBalance.rows.length === 1)
    t.true(Number(channelBalance.rows[0].balance) === 10.0 * txs)
  } finally {
    client.release()
  }
})
