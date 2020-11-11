const { serial: test } = require('ava')
const config = require('../../config')
const utils = require('../utils')
const _ = require('underscore')
const {
  routes: publisherRoutes,
  initialize: publisherInitializer
} = require('../../eyeshade/controllers/publishers')
const {
  setupForwardingServer,
  cleanDbs
} = utils
const {
  BAT_POSTGRES_URL,
  ALLOWED_PUBLISHERS_TOKENS
} = process.env

test.before(async (t) => {
  const {
    runtime,
    agent
  } = await setupForwardingServer({
    token: ALLOWED_PUBLISHERS_TOKENS,
    routes: publisherRoutes,
    initers: [publisherInitializer],
    config: Object.assign({}, config, {
      forward: {
        settlements: '1'
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

test('settlements inserted using old methodology will match new insertion methodology', async (t) => {
  const settlement = utils.settlement.createLegacy(null, '71341fc9-aeab-4766-acf0-d91d3ffb0bfa')

  await utils.settlement.sendLegacy([settlement])
  const rowsLegacy = await utils.transaction.ensureCount(t, 3)

  await cleanDbs()
  // use kafka
  await utils.settlement.sendLegacy([settlement], t.context.agent)
  const rows = await utils.transaction.ensureCount(t, 3)

  const fields = [
    'id', 'description', 'transaction_type',
    'from_account_type', 'from_account', 'to_account_type',
    'to_account', 'amount', 'channel', 'settlement_currency',
    'settlement_amount'
  ]
  t.deepEqual(
    /*
    document_id
    5f6e09f1d20e8bb493f69c80 vs5f6e09f40000000000000000
    */
    rowsLegacy.map((row) => _.pick(row, fields)),
    rows.map((row) => _.pick(row, fields))
  )
})
