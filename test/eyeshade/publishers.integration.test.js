'use strict'
import { serial as test } from 'ava'
import uuidV4 from 'uuid/v4'
import fs from 'fs'
import path from 'path'
import BigNumber from 'bignumber.js'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { agent } from 'supertest'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import {
  makeSettlement,
  cleanDbs,
  cleanPgDb,
  braveYoutubePublisher,
  eyeshadeAgent,
  connectToDb,
  ok
} from '../utils'

const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})

test.afterEach.always(async t => {
  await cleanPgDb(postgres)()
  await cleanDbs()
})

test('unauthed requests cannot post settlement', async t => {
  const unauthedAgent = agent(process.env.BAT_EYESHADE_SERVER)
  const url = `/v2/publishers/settlement`
  const response = await unauthedAgent.post(url).send({}).expect(401)
  t.true(response.status === 401)
})

test('cannot post payouts if the publisher field is blank and type is not manual', async t => {
  const url = `/v2/publishers/settlement`
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

  const reponse = await eyeshadeAgent.post(url).send([manualSettlement])
  t.true(reponse.status === 400)
})

test('can post a manual settlement from publisher app using token auth', async t => {
  const url = `/v2/publishers/settlement`
  const eyeshadeMongo = await connectToDb('eyeshade')
  const settlements = eyeshadeMongo.collection('settlements')
  const client = await postgres.connect()

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
    type: 'manual',
    documentId: uuidV4().toLowerCase(),
    hash: uuidV4().toLowerCase()
  }

  await eyeshadeAgent.post(url).send([manualSettlement]).expect(200)

  // ensure the manual settlement doc was created with the document id
  const settlementDoc = await settlements.findOne({settlementId: manualSettlement.transactionId})
  t.true(settlementDoc.type === 'manual')
  t.true(settlementDoc.documentId === manualSettlement.documentId)

  // ensure both transactions were entered into transactions table
  const manualTxsQuery = `select * from transactions where transaction_type = 'manual';`
  const manualSettlementTxQuery = `select * from transactions where transaction_type = 'manual_settlement';`

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
})

test('settlement receives a file', async (t) => {
  t.plan(2)
  const jsonFile = path.join(__dirname, `publishers-${uuidV4()}.json`)
  const selectByAddress = 'SELECT * FROM transactions WHERE to_account = $1;'
  const deleteByChannel = 'DELETE FROM transactions WHERE channel = $1;'
  const amount = 20

  // setup
  const settlement1 = makeSettlement('contribution', amount)
  const settlementAddress1 = settlement1.address
  const settlements = [settlement1]
  const settlementBinary = JSON.stringify(settlements)
  fs.writeFileSync(jsonFile, settlementBinary.toString())

  // test
  await eyeshadeAgent
    .post('/v3/publishers/settlement')
    .attach(jsonFile, jsonFile)
    .set('Content-Type', 'application/json')
    .expect(ok)

  let rows = null
  do {
    await timeout(2000)
    const result = await postgres.query(selectByAddress, [settlementAddress1])
    rows = result.rows
  } while (!rows || !rows.length)
  const sentAmount = (new BigNumber(amount)).times(0.95)
  const transactedAmount = rows.reduce((memo, tx) => {
    return memo.plus(tx.amount)
  }, new BigNumber(0))
  t.true(amount > 1)
  t.is(sentAmount.toString(), transactedAmount.toString())

  // cleanup
  fs.unlinkSync(jsonFile)
  await postgres.query(deleteByChannel, [braveYoutubePublisher])
  const eyeshade = await connectToDb('eyeshade')
  const settlementsCollection = eyeshade.collection('settlements')
  await settlementsCollection.remove({
    address: settlementAddress1
  })
})
