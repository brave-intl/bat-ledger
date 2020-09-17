const { serial: test } = require('ava')
const { kafka } = require('../../config')
const { timeout } = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')
const referrals = require('../lib/referrals')
const utils = require('../../test/utils')

test.before((t) => {
  Object.assign(t.context, {
    runtime: new Runtime({
      postgres: { url: process.env.BAT_POSTGRES_URL },
      kafka
    })
  })
})
test.beforeEach(utils.cleanDbs)

test('referrals should be insertable from the kafka queue', async (t) => {
  const msgs = 10
  for (let i = 0; i < msgs; i += 1) {
    const referral = utils.referral.create()
    const buf = referrals.typeV1.toBuffer(referral)
    await t.context.runtime.kafka.send(referrals.topic, buf)
  }
  await t.notThrowsAsync(
    utils.referral.ensureCount(t, msgs)
  )
})

test('messages are deduplicated', async t => {
  const referralBase = JSON.stringify(utils.referral.create())
  const referral1 = JSON.parse(referralBase)

  const messages = []
  for (let i = 0; i < 5; i += 1) {
    messages.push([])
    for (let j = 0; j < 10; j += 1) {
      messages[i].push(referral1)
    }
  }
  // a signal that messages have been processed
  const endingReferral = utils.referral.create()
  messages.push([endingReferral])

  for (let i = 0; i < messages.length; i += 1) {
    // send in blocks
    await Promise.all(messages[i].map((msg) => (
      t.context.runtime.kafka.send(
        referrals.topic,
        referrals.typeV1.toBuffer(msg)
      )
    )))
    await timeout(0)
  }
  await t.notThrowsAsync(
    utils.referral.ensureArrived(t, endingReferral.transactionId)
  )
  // 1 for the first transaction seen
  // 1 for the ending transaction
  await t.notThrowsAsync(
    utils.referral.ensureCount(t, 2)
  )
})
