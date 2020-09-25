const { serial: test } = require('ava')
const config = require('../../config')
const utils = require('../utils')
const _ = require('underscore')
const {
  routes: referralRoutes,
  initialize: referralInitializer
} = require('../../eyeshade/controllers/referrals')
const {
  setupForwardingServer,
  cleanDbs
} = utils
const {
  BAT_POSTGRES_URL,
  ALLOWED_REFERRALS_TOKENS
} = process.env

test.before(async (t) => {
  const {
    runtime,
    agent
  } = await setupForwardingServer({
    token: ALLOWED_REFERRALS_TOKENS,
    routes: referralRoutes,
    initers: [referralInitializer],
    config: Object.assign({}, config, {
      forward: {
        referrals: '1'
      },
      postgres: {
        url: BAT_POSTGRES_URL
      }
    })
  })

  Object.assign(t.context, {
    agent,
    runtime
  })
})
test.beforeEach(cleanDbs)

test('referrals inserted using old methodology will match new insertion methodology', async (t) => {
  const {
    txId,
    referral
  } = utils.referral.createLegacy(null, '71341fc9-aeab-4766-acf0-d91d3ffb0bfa')

  await utils.referral.sendLegacy(txId, [referral])
  const rowsLegacy = await utils.transaction.ensureCount(t, 1)

  await cleanDbs()
  // use kafka
  await utils.referral.sendLegacy(txId, [referral], t.context.agent)
  const rows = await utils.transaction.ensureCount(t, 1)
  const fields = [
    'id', 'description', 'transaction_type', 'document_id',
    'from_account_type', 'from_account', 'to_account_type',
    'to_account', 'channel', 'settlement_currency',
    'settlement_amount'
  ]
  t.deepEqual(
    rowsLegacy.map((row) => _.pick(row, fields)),
    rows.map((row) => _.pick(row, fields))
  )
})
