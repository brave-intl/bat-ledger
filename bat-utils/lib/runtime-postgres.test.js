'use strict'

import Postgres from './runtime-postgres.js'
import test from 'ava'
import { v4 } from 'uuid'
import _ from 'underscore'
import { toBat } from './extras-utils'
const { types } = Postgres

const postgres = Postgres({
  postgres: {
    settings: {}
  }
})
test('connects to database', async t => {
  t.plan(0)
  await postgres.connected()
})
test('transactionsFrom > always returns an array', async t => {
  t.plan(4)
  t.true(_.isArray(postgres.transactionsFrom()))
  t.true(_.isArray(postgres.transactionsFrom('fake')))
  // correct key, missing object
  t.true(_.isArray(postgres.transactionsFrom('settlement')))
  t.true(_.isArray(postgres.transactionsFrom('settlement', {})))
})

test('fills settlement data with what is available', async t => {
  t.plan(2)
  // did not err
  const createdAt = new Date()
  const transactionType = 'settlement'
  const settlementTransactions = postgres.transactionsFrom(transactionType, {
    probi: 1,
    fees: 1,
    owner: 'mysite.com',
    createdAt
  })
  // returned array
  // with one thing in it... though, incomplete data
  t.deepEqual(settlementTransactions, [{
    createdAt,
    description: Postgres.createTypeDescription(transactionType, undefined, createdAt),
    transactionType,
    documentId: undefined,
    amount: '1',
    // default is bat
    settlementCurrency: 'BAT',
    settlementAmount: '0.000000000000000001',
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.UPHOLD,
    toAccount: undefined
  }])
  // no await
  await t.throws(postgres.insertTransactions(settlementTransactions), Error)
})

test('fills settlement data with correct data', async t => {
  t.plan(1)
  // filled with correct data
  const createdAt = new Date()
  const probi = 1000000000000
  const fees = 1000
  const owner = 'brave.com'
  const type = 'referral'
  const currency = 'BTC'
  const transactionType = 'settlement'
  const settlementId = v4().toLowerCase()
  const address = v4().toLowerCase()
  const fullSettlementTransactions = postgres.transactionsFrom(transactionType, {
    probi,
    fees,
    owner,
    createdAt,
    type,
    settlementId,
    address,
    currency
  })
  t.deepEqual(fullSettlementTransactions, [{
    createdAt,
    documentId: settlementId,
    description: Postgres.createTypeDescription(transactionType, type, createdAt),
    transactionType,
    amount: probi + '',
    settlementCurrency: currency,
    settlementAmount: toBat(probi).toString(),
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.UPHOLD,
    toAccount: address
  }])
  // was successful
  await postgres.insertTransactions(fullSettlementTransactions)
})

test('fills settlement data with correct contribution data', async t => {
  t.plan(1)
  // filled with correct data
  const createdAt = new Date()
  const probi = 1000000000000
  const fees = 1000
  const identifier = v4().toLowerCase()
  const owner = `publishers#uuid:${identifier}`
  const type = 'contribution'
  const currency = 'BTC'
  const transactionType = 'contribution'
  const settlementId = v4().toLowerCase()
  const documentId = settlementId
  const address = v4().toLowerCase()
  const hash = v4().toLowerCase()
  const publisher = v4().toLowerCase()
  const SETTLEMENT = 'settlement'
  const fullSettlementTransactions = postgres.transactionsFrom(SETTLEMENT, {
    probi,
    publisher,
    fees,
    hash,
    owner,
    createdAt,
    type,
    settlementId,
    address,
    currency
  })
  t.deepEqual(fullSettlementTransactions, [{
    createdAt,
    documentId: hash,
    description: Postgres.createDescription(type, createdAt),
    transactionType,
    amount: (probi + fees) + '',
    fromAccountType: 'channel',
    fromAccount: publisher,
    toAccountType: types.OWNER,
    toAccount: identifier
  }, {
    createdAt,
    documentId: hash,
    description: Postgres.createTypeDescription('fees', type, createdAt),
    transactionType: 'fees',
    amount: fees + '',
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.UPHOLD,
    toAccount: Postgres.feeAddress()
  }, {
    createdAt,
    documentId,
    description: Postgres.createTypeDescription(SETTLEMENT, type, createdAt),
    transactionType: SETTLEMENT,
    amount: probi + '',
    settlementCurrency: currency,
    settlementAmount: toBat(probi).toString(),
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.UPHOLD,
    toAccount: address
  }])
  await postgres.insertTransactions(fullSettlementTransactions)
})

test('fills voting data with correct data', async t => {
  t.plan(1)
  // filled with correct data
  const createdAt = new Date()
  const probi = 1000000000000
  const fees = 1000
  const owner = 'brave.com'
  const type = 'referral'
  const currency = 'BTC'
  const settlementId = v4().toLowerCase()
  const publisher = v4().toLowerCase()
  const surveyorId = v4().toLowerCase()
  const fullVotingTransactions = postgres.transactionsFrom('vote', {
    probi,
    fees,
    owner,
    createdAt,
    type,
    settlementId,
    publisher,
    currency,
    surveyorId
  })
  t.deepEqual(fullVotingTransactions, [{
    createdAt,
    documentId: createdAt,
    description: Postgres.createVoteDescription(surveyorId),
    transactionType: 'contribution',
    amount: probi + '',
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.CHANNEL,
    toAccount: publisher
  }])
  await postgres.insertTransactions(fullVotingTransactions)
})

test('fills referral data with correct data', async t => {
  t.plan(1)
  // filled with correct data
  const createdAt = new Date()
  const probi = 1000000000000
  const fees = 1000
  const type = 'referral'
  const publisher = v4().toLowerCase()
  const owner = `publishers#uuid:${publisher}`
  const settlementId = v4().toLowerCase()
  const transactionId = v4().toLowerCase()
  const fullReferralTransactions = postgres.transactionsFrom(type, {
    probi,
    fees,
    createdAt,
    type,
    publisher,
    settlementId,
    owner,
    transactionId
  })
  t.deepEqual(fullReferralTransactions, [{
    createdAt,
    documentId: Postgres.createReferralDescription(transactionId, publisher),
    transactionType: type,
    amount: probi + '',
    fromAccountType: types.UPHOLD,
    fromAccount: Postgres.settlementAddress(),
    toAccountType: types.OWNER,
    toAccount: publisher
  }])
  await postgres.insertTransactions(fullReferralTransactions)
})
