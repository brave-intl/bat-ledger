const { serial: test } = require('ava')
const { kafka } = require('../../config')
const { timeout, normalizeChannel } = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')
const transaction = require('../lib/transaction')
const settlements = require('../lib/settlements')
const utils = require('../../test/utils')
const { cleanEyeshadePgDb } = require('../../test/utils')

test.before((t) => {
  Object.assign(t.context, {
    runtime: new Runtime({
      postgres: { url: process.env.BAT_POSTGRES_URL },
      kafka
    })
  })
})
test.beforeEach((t) => cleanEyeshadePgDb(t.context.runtime.postgres))

test('settlements should be insertable from the kafka queue', async (t) => {
  const msgs = 10
  for (let i = 0; i < msgs; i += 1) {
    const settlement = utils.settlement.create()
    const buf = settlements.encode(settlement)
    await t.context.runtime.kafka.send(settlements.topic, buf)
  }
  await t.notThrowsAsync(
    utils.transaction.ensureCount(t, msgs * 3)
  )
})

test('messages are deduplicated', async t => {
  const settlementBase = JSON.stringify(utils.settlement.create())
  const settlement1 = JSON.parse(settlementBase)

  const messages = []
  for (let i = 0; i < 5; i += 1) {
    messages.push([])
    for (let j = 0; j < 10; j += 1) {
      messages[i].push(settlement1)
    }
  }
  // a signal that messages have been processed
  const endingSettlement = utils.settlement.create()
  messages.push([endingSettlement])

  for (let i = 0; i < messages.length; i += 1) {
    // send in blocks
    await Promise.all(messages[i].map((msg) => (
      t.context.runtime.kafka.send(
        settlements.topic,
        settlements.encode(msg)
      )
    )))
    await timeout(0)
  }

  const normalizedChannel = normalizeChannel(endingSettlement.publisher)
  const id = transaction.id.settlement(endingSettlement.settlementId, normalizedChannel, endingSettlement.type)
  await t.notThrowsAsync(
    utils.transaction.ensureArrived(t, id)
  )
  // 1 for the first transaction seen
  // 1 for the ending transaction
  await t.notThrowsAsync(
    utils.transaction.ensureCount(t, 2 * 3)
  )
})
