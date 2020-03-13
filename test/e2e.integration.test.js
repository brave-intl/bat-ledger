'use strict'
import parsePrometheusText from 'parse-prometheus-text-format'
import { serial as test } from 'ava'
import _ from 'underscore'
import dotenv from 'dotenv'
import { agent } from 'supertest'
import { Runtime } from 'bat-utils'
import {
  cleanDbs,
  cleanPgDb,
  ok
} from './utils'
dotenv.config()

const runtime = new Runtime({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  },
  queue: {
    rsmq: process.env.BAT_REDIS_URL
  },
  cache: {
    redis: {
      url: process.env.BAT_REDIS_URL
    }
  },
  prometheus: {
    label: process.env.SERVICE + '.worker.1'
  }
})

test.afterEach.always(cleanDbs)
test.afterEach.always(cleanPgDb(runtime.postgres))

test('check /metrics is up with no authorization', async (t) => {
  const {
    BAT_BALANCE_SERVER,
    BAT_EYESHADE_SERVER,
    BAT_LEDGER_SERVER
  } = process.env

  await checkMetrics(BAT_EYESHADE_SERVER)
  await checkMetrics(BAT_BALANCE_SERVER)
  await checkMetrics(BAT_LEDGER_SERVER)

  async function checkMetrics (origin) {
    const {
      text
    } = await agent(origin)
      .get('/metrics')
      .expect(ok)
    t.true(_.isArray(parsePrometheusText(text)), 'a set of metrics is sent back')
  }
})
