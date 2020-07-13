'use strict'
const parsePrometheusText = require('parse-prometheus-text-format')
const { serial: test } = require('ava')
const _ = require('underscore')
const dotenv = require('dotenv')
const { agent } = require('supertest')
const {
  ok
} = require('./utils')

dotenv.config()

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
