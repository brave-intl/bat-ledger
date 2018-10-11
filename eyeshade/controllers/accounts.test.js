'use strict'
import {
  serial as test
} from 'ava'
import Cache from 'bat-utils/lib/runtime-cache'
import Postgres from 'bat-utils/lib/runtime-postgres'
import Server from 'bat-utils/lib/hapi-server'
import BigNumber from 'bignumber.js'
import uuid from 'uuid'
import supertest from 'supertest'

import dotenv from 'dotenv'
import { v1 } from './accounts'
dotenv.config()

let server
let local

const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})
const cache = new Cache({
  cache: {
    redis: {
      url: process.env.BAT_REDIS_URL || 'redis://localhost:6379'
    }
  }
})

const runtime = {
  postgres,
  config: {
    server: {},
    wallet: {
      settlementAddress: {
        BAT: '0x12345'
      }
    }
  },
  notify: () => {},
  cache,
  captureException: () => {}
}

const serverPromise = Server({
  id: '1',
  routes: {
    routes: async () => ({
      path: '/v1/accounts/{payment_id}/transactions/ads/{token_id}',
      method: 'PUT',
      handler: v1.adTransactions.handler(runtime)
    })
  }
}, runtime)

test.before(async () => {
  server = await serverPromise
  await server.started
  local = supertest.agent(server.listener)
})
test.after(async () => {
  await server.stop({
    timeout: 1
  })
})

const amount = (new BigNumber(1e18)).dividedBy(1e18).toString()
const paymentId = 'payment-id-1234589'
const transactionId = uuid.v4().toLowerCase()
const url = `/v1/accounts/${paymentId}/transactions/ads/${transactionId}`
const payload = {
  amount
}
test('fails if bad values are given', async (t) => {
  t.plan(0)
  await local
    .put(url)
    .send({})
    .expect(400)
  await local
    .put(url)
    .send({ amount: 5 })
    .expect(400)

  await remove(runtime, transactionId)
})
test('inserts a transaction into the table and errs on subsequent tries', async (t) => {
  t.plan(0)

  await local
    .put(url)
    .send(payload)
    .expect(200)

  await local
    .put(url)
    .send(payload)
    .expect(409)

  await remove(runtime, transactionId)
})

function remove (runtime, transactionId) {
  return runtime.postgres.query('DELETE FROM transactions WHERE document_id = $1::text;', [transactionId])
}
