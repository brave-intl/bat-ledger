'use strict'

import {
  serial as test
} from 'ava'
import uuidV4 from 'uuid/v4'
import {
  cleanPgDb,
  connectToDb,
  cleanDbs
} from '../utils'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { monthly } from '../../eyeshade/workers/ads'

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })

test.afterEach.always(async t => {
  await cleanPgDb(postgres)()
  await cleanDbs()
})

test('ads payout report cron job takes a snapshot of balances', async t => {
  const eyeshadeMongo = await connectToDb('eyeshade')
  const wallets = eyeshadeMongo.collection('wallets')

  // Create the wallet that will receive payment
  const paymentId = uuidV4()
  const providerId = uuidV4()
  await wallets.insert({paymentId, providerId})

  // Create an ad transaction so there is a payment_id with a balance
  const txId = uuidV4()
  const createdAt = new Date()
  const description = 'funding tx for viewing ads'
  const transactionType = 'ad'
  const fromAccountType = 'uphold'
  const fromAccount = uuidV4()
  const toAccountType = 'payment_id'
  const amount = 1000

  const insertQuery = `insert into transactions (id, created_at, description, transaction_type, from_account_type, from_account, to_account_type, to_account, amount) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
  await postgres.query(insertQuery, [txId, createdAt, description, transactionType, fromAccountType, fromAccount, toAccountType, paymentId, amount])

  // Refresh the account balances materialized view so the balance filters through
  await postgres.query(`refresh materialized view account_balances`)

  // Run the payout report
  await monthly({}, { postgres: postgres, database: eyeshadeMongo })

  // Ensure the wallet balance made it in
  const potentialPayments = (await postgres.query(`select * from potential_payments_ads`)).rows
  t.true(potentialPayments.length === 1)

  const potentialPayment = potentialPayments[0]
  t.true(potentialPayment.payment_id === paymentId)
  t.true(potentialPayment.provider_id === providerId)
  t.true(potentialPayment.amount === '1000.000000000000000000')
})
