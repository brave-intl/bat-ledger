const { serial: test } = require('ava')
const uuidV4 = require('uuid/v4')
const moment = require('moment')
const { kafka } = require('../../config')
const { BigNumber, timeout } = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')
const referrals = require('./referrals')
const {
  braveYoutubePublisher
} = require('../../test/utils')

test.before((t) => {
  Object.assign(t.context, {
    runtime: new Runtime({
      postgres: { url: process.env.BAT_POSTGRES_URL },
      kafka
    })
  })
})

test('referrals should be serializable and decodable', (t) => {
  const referral = createReferral()
  const buf = referrals.typeV1.toBuffer(referral)
  t.true(Buffer.isBuffer(buf), 'should be serializable into a buffer')
  const decoded = referrals.decode(buf)
  t.is(decoded.version, 1, 'should be version 1 by default')
  const obj = referrals.objectify(decoded)
  t.deepEqual(referral, obj, 'message input should match output')
})

test('referrals should be insertable from the kafka queue', async (t) => {
  t.plan(0)
  const msgs = 10
  for (let i = 0; i < msgs; i += 1) {
    const referral = createReferral()
    const buf = referrals.typeV1.toBuffer(referral)
    await t.context.runtime.kafka.send(referrals.topic, buf)
  }
  let rows = []
  while (rows.length !== msgs) {
    await timeout(1000)
    ;({ rows } = await t.context.runtime.postgres.query('select * from transactions'))
  }
})

function createReferral () {
  return {
    id: uuidV4(),
    transactionId: uuidV4(),
    owner: 'publishers#uuid:' + uuidV4().toLowerCase(),
    publisher: braveYoutubePublisher,
    altcurrency: 'BAT',
    createdAt: moment().toISOString(),
    inputs: [{
      finalized: moment().toISOString(),
      downloadId: uuidV4(),
      downloadTimestamp: moment().toISOString(),
      countryGroupId: uuidV4(),
      platform: 'desktop',
      payoutRate: '4',
      referralCode: 'ABC123',
      probi: new BigNumber(Math.random() + '').times(1e18).toString()
    }]
  }
}
