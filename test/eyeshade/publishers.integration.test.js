'use strict'
const _ = require('underscore')
const { serial: test } = require('ava')
const { v4: uuidV4 } = require('uuid')
const {
  ok,
  cleanEyeshadePgDb,
  agents
} = require('../utils')
const {
  timeout
} = require('bat-utils/lib/extras-utils')
const Postgres = require('bat-utils/lib/runtime-postgres')

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })

test.afterEach.always(cleanEyeshadePgDb.bind(null, postgres))

test('unauthed requests cannot post settlement', async t => {
  t.plan(0)
  await agents.eyeshade.global
    .post('/v2/publishers/settlement')
    .send({})
    .expect(403)
})

test('cannot post payouts if the publisher field is blank and type is not manual', async t => {
  t.plan(0)
  const url = '/v2/publishers/settlement'
  const manualSettlement = {
    owner: 'publishers#uuid:' + uuidV4().toLowerCase(),
    publisher: '',
    address: uuidV4().toLowerCase(),
    altcurrency: 'BAT',
    probi: '5000000000000000000',
    fees: '0',
    currency: 'BAT',
    amount: '5',
    commission: '0.0',
    transactionId: uuidV4().toLowerCase(),
    type: 'contribution',
    documentId: uuidV4().toLowerCase(),
    hash: uuidV4().toLowerCase()
  }

  await agents.eyeshade.publishers.post(url).send([manualSettlement]).expect(400)
})

test('can post a manual settlement from publisher app using token auth', async t => {
  const url = '/v2/publishers/settlement'
  const client = await postgres.connect()

  const owner = 'publishers#uuid:' + uuidV4().toLowerCase()
  const manualSettlement = {
    owner,
    publisher: '',
    address: uuidV4().toLowerCase(),
    altcurrency: 'BAT',
    probi: '5000000000000000000',
    fees: '0',
    currency: 'BAT',
    amount: '5',
    commission: '0.0',
    transactionId: uuidV4().toLowerCase(),
    type: 'manual',
    documentId: uuidV4().toLowerCase(),
    hash: uuidV4().toLowerCase()
  }

  await agents.eyeshade.publishers.post(url).send([manualSettlement]).expect(200)

  // ensure both transactions were entered into transactions table
  const manualTxsQuery = 'select * from transactions where transaction_type = \'manual\';'
  const manualSettlementTxQuery = 'select * from transactions where transaction_type = \'manual_settlement\';'

  let rows
  do { // wait until settlement-report is processed and transactions are entered into postgres
    await timeout(500).then(async () => {
      rows = (await client.query(manualTxsQuery)).rows
    })
  } while (rows.length === 0)

  const manualTx = rows[0]
  t.true(rows.length === 1)

  rows = (await client.query(manualSettlementTxQuery)).rows
  t.true(rows.length === 1)
  const manualSettlementTx = rows[0]

  t.true(manualTx.description === 'handshake agreement with business developement')
  t.true(manualTx.document_id === manualSettlement.documentId)
  t.true(manualTx.transaction_type === 'manual')
  t.true(manualTx.from_account_type === 'uphold')
  t.true(manualTx.from_account === process.env.BAT_SETTLEMENT_ADDRESS)
  t.true(manualTx.to_account_type === 'owner')
  t.true(manualTx.to_account === manualSettlement.owner)
  t.true(manualTx.amount === '5.000000000000000000')
  t.true(manualTx.channel === null)
  t.true(manualTx.settlement_currency === null)
  t.true(manualTx.settlement_amount === null)

  t.true(manualSettlementTx.description === 'payout for manual')
  t.true(manualSettlementTx.document_id === manualSettlement.documentId)
  t.true(manualSettlementTx.transaction_type === 'manual_settlement')
  t.true(manualSettlementTx.from_account_type === 'owner')
  t.true(manualSettlementTx.from_account === manualSettlement.owner)
  t.true(manualSettlementTx.to_account_type === 'uphold')
  t.true(manualSettlementTx.to_account === manualSettlement.address)
  t.true(manualSettlementTx.amount === '5.000000000000000000')
  t.true(manualSettlementTx.settlement_currency === 'BAT')
  t.true(manualSettlementTx.settlement_amount === '5.000000000000000000')

  t.true(manualTx.to_account === manualSettlementTx.from_account)

  const {
    body
  } = await agents.eyeshade.publishers
    .get(`/v1/accounts/${encodeURIComponent(owner)}/transactions`)
    .expect(ok)

  const subset = _.map(body, (item) => _.omit(item, ['created_at']))
  const manualSettlementResponse = _.findWhere(subset, { transaction_type: 'manual_settlement' })

  t.deepEqual({
    channel: '',
    description: 'payout for manual',
    amount: '-5.000000000000000000',
    settlement_currency: 'BAT',
    settlement_amount: '5.000000000000000000',
    transaction_type: 'manual_settlement'
  }, manualSettlementResponse, 'a manual settlement is sent back with the appropriate data')
})

test('only can post settlement files under to 20mbs', async t => {
  const url = '/v2/publishers/settlement'

  const bigSettlement = {
    owner: 'publishers#uuid:' + uuidV4().toLowerCase(),
    publisher: '',
    address: '🌝',
    altcurrency: '🚀'.repeat(256 * 1024 * 20), // rocket is 4 bytes
    probi: '5000000000000000000',
    fees: '0',
    currency: 'BAT',
    amount: '5',
    commission: '0.0',
    transactionId: uuidV4().toLowerCase(),
    type: 'manual',
    documentId: uuidV4().toLowerCase(),
    hash: uuidV4().toLowerCase()
  }

  const smallSettlement = {
    owner: 'publishers#uuid:' + uuidV4().toLowerCase(),
    publisher: '',
    address: uuidV4().toLowerCase(),
    altcurrency: 'BAT',
    probi: '5000000000000000000',
    fees: '0',
    currency: 'BAT',
    amount: '5',
    commission: '0.0',
    transactionId: uuidV4().toLowerCase(),
    type: 'manual',
    documentId: uuidV4().toLowerCase(),
    hash: uuidV4().toLowerCase()
  }

  // ensure settlement files > 20mb fail
  const response = await agents.eyeshade.publishers.post(url).send([bigSettlement])
  t.is(413, response.statusCode)
  t.true(response.body.message === 'Payload content length greater than maximum allowed: 20971520')

  // ensure small settlement files succeed
  await agents.eyeshade.publishers.post(url).send([smallSettlement]).expect(200)
})
