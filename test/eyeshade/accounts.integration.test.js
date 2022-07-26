'use strict'

const {
  serial: test
} = require('ava')
const { v4: uuidV4 } = require('uuid')
const _ = require('underscore')
const {
  insertTransaction,
  insertFromSettlement,
  insertFromReferrals
} = require('../../eyeshade/lib/transaction')

const {
  Runtime,
  extras
} = require('bat-utils')
const {
  cleanEyeshadePgDb,
  agents,
  ok
} = require('../utils')

const { utils: braveUtils } = extras
const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const settlementId = uuidV4().toLowerCase()
const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()
const toOwnerId = 'publishers#uuid:' + uuidV4().toLowerCase()
const runtime = new Runtime({
  postgres: { url: process.env.BAT_POSTGRES_URL },
  currency: {
    url: process.env.BAT_RATIOS_URL,
    access_token: process.env.BAT_RATIOS_TOKEN
  },
  wallet: {
    settlementAddress: { BAT: '0xdeadbeef' },
    adsPayoutAddress: { BAT: '0xdeadbeef' }
  }
})

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

const referralsBar = {
  probi: '12000000000000000000',
  firstId: docId,
  transactionId: uuidV4().toLowerCase(),
  _id: {
    altcurrency: 'BAT',
    owner: ownerId,
    publisher: 'bar.com'
  }
}

const manualTransaction = (ownerId) => ({
  id: uuidV4(),
  createdAt: +(new Date()) / 1000,
  description: 'a random manual tx',
  transactionType: 'manual',
  documentId: uuidV4(),
  fromAccount: toOwnerId,
  fromAccountType: 'uphold',
  toAccount: ownerId,
  toAccountType: 'uphold',
  amount: 1
})

const manualTransactionSettlement = (ownerId) => ({
  probi: '1000000000000000000',
  fees: '0',
  altcurrency: 'BAT',
  _id: docId,
  type: 'manual',
  owner: ownerId,
  settlementId,
  address: uuidV4().toLowerCase(),
  amount: '10',
  currency: 'BAT'
})

test.afterEach.always(cleanEyeshadePgDb.bind(null, runtime.postgres))

test('check auth scope', async (t) => {
  t.plan(0)
  await agents.eyeshade.global.get('/v1/accounts/settlements/referrals/total').expect(403)
  await agents.eyeshade.global.get('/v1/accounts/earnings/referral/total').expect(403)
  await agents.eyeshade.global.get('/v1/accounts/owner/transactions').expect(403)
})

test('check settlement totals', async t => {
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
    ;({ body } = await agents.eyeshade.publishers
      .get(`/v1/accounts/settlements/${type}/total`)
      .send()
      .expect(ok))
    t.deepEqual(body, [{
      channel: 'bar.com',
      paid: '12.000000000000000000',
      account_id: referralSettlement.owner
    }, {
      channel: 'foo.com',
      paid: '10.000000000000000000',
      account_id: referralSettlement.owner
    }])

    const referralMonth = new Date('2018-07-01')
    const referralMonthISO = referralMonth.toISOString()
    const encodedMonth = encodeURIComponent(referralMonthISO)
    const referralMonthChangedISO = braveUtils.changeMonth(referralMonth).toISOString()
    const encodedMonthChanged = encodeURIComponent(referralMonthChangedISO)

    const { body: referralMonthChangedData } = await agents.eyeshade.publishers
      .get(`/v1/accounts/settlements/${type}/total?start=${encodedMonthChanged}&order=asc`)

      .send()
      .expect(ok)
    t.deepEqual([], referralMonthChangedData)

    const { body: referralMonthData } = await agents.eyeshade.publishers
      .get(`/v1/accounts/settlements/${type}/total?start=${encodedMonth}&order=asc`)

      .send()
      .expect(ok)

    type = 'referrals'
    ;({ body } = await agents.eyeshade.publishers.get(`/v1/accounts/settlements/${type}/total?order=asc`).send().expect(ok))
    t.deepEqual(referralMonthData, body)
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
  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')
    await insertFromReferrals(runtime, client, referrals)
    await insertFromReferrals(runtime, client, referralsBar)
    await client.query('COMMIT')
    let type
    let body

    type = 'referrals'
    ;({ body } = await agents.eyeshade.publishers.get(`/v1/accounts/earnings/${type}/total`).send().expect(ok))
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
    ;({ body } = await agents.eyeshade.publishers.get(`/v1/accounts/earnings/${type}/total?order=asc`).send().expect(ok))
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

  await insertFromSettlement(runtime, client, referralSettlement)
  await insertFromSettlement(runtime, client, _.assign({}, referralSettlement, {
    publisher: 'bar.com',
    amount: '12',
    probi: '12000000000000000000'
  }))

  const transactionsURL = `/v1/accounts/${encodeURIComponent(ownerId)}/transactions`
  const { body } = await agents.eyeshade.publishers.get(transactionsURL).expect(ok)
  t.true(body.length >= 1)
  const count = body.reduce((memo, transaction) => _.keys(transaction).reduce((memo, key) => {
    return memo + (transaction[key] == null ? 1 : 0)
  }, memo), 0)
  t.is(count, 0)
})

test('create ads payment fails if bad values are given', async (t) => {
  t.plan(0)

  const paymentId = uuidV4().toLowerCase()
  const transactionId = uuidV4().toLowerCase()
  const url = `/v1/accounts/${paymentId}/transactions/ads/${transactionId}`

  await agents.eyeshade.ads
    .put(url)
    .send({})
    .expect(400)

  await agents.eyeshade.ads
    .put(url)
    .send({ amount: 0 })
    .expect(400)

  await agents.eyeshade.ads
    .put(url)
    .send({ amount: 5 })
    .expect(400)
})

test('ads payment api inserts a transaction into the table and errs on subsequent tries', async (t) => {
  t.plan(0)

  const paymentId = uuidV4().toLowerCase()
  const transactionId = uuidV4().toLowerCase()
  const url = `/v1/accounts/${paymentId}/transactions/ads/${transactionId}`
  const payload = {
    amount: '1'
  }

  await agents.eyeshade.ads
    .put(url)
    .send(payload)
    .expect(ok)

  await agents.eyeshade.ads
    .put(url)
    .send(payload)
    .expect(409)
})

test('a uuid can be sent as an account id', async (t) => {
  let response

  const uuid = uuidV4()
  const url = `/v1/accounts/${uuid}/transactions`
  response = await agents.eyeshade.publishers.get(url).send().expect(ok)
  t.deepEqual(response.body, [], 'no txs matched')

  await insertTransaction(runtime, null, manualTransaction(uuid))

  response = await agents.eyeshade.publishers.get(url).send().expect(ok)
  const { body: empty } = response
  t.is(empty.length, 1, 'zero txs are matched')

  await insertFromSettlement(runtime, null, manualTransactionSettlement(uuid))

  response = await agents.eyeshade.publishers.get(url).send().expect(ok)
  const { body } = response
  t.is(body.length, 3, 'three txs matched')
  const tx = body[0]
  t.is(tx.channel, '', 'channel can be empty')
})
