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
  cleanDbs,
  connectToDb
} = utils
const {
  ALLOWED_REFERRALS_TOKENS
} = process.env

test.before(async (t) => {
  const eyeshadeMongo = await connectToDb('eyeshade')
  const {
    runtime,
    agent
  } = await setupForwardingServer({
    token: ALLOWED_REFERRALS_TOKENS,
    routes: referralRoutes,
    initers: [referralInitializer],
    // database, postgres, currency, prometheus, config
    config: Object.assign({}, config, {
      forward: {
        referrals: '1'
      }
    })
  })

  Object.assign(t.context, {
    agent,
    referrals: await eyeshadeMongo.collection('referrals'),
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
    'to_account', 'amount', 'channel', 'settlement_currency',
    'settlement_amount'
  ]
  t.deepEqual(
    _.pick(rowsLegacy, fields),
    _.pick(rows, fields)
  )
})
