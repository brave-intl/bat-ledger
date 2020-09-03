const { serial: test } = require('ava')
const uuidV4 = require('uuid/v4')
const moment = require('moment')

const { BigNumber } = require('bat-utils/lib/extras-utils')

const referrals = require('./referrals')
const {
  braveYoutubeOwner,
  braveYoutubePublisher
} = require('../../test/utils')

test('referrals should be serializable and decodable', (t) => {
  const referral = {
    id: uuidV4(),
    transactionId: uuidV4(),
    owner: braveYoutubeOwner,
    publisher: braveYoutubePublisher,
    altcurrency: 'BAT',
    createdAt: (+moment()) + '',
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
  const buf = referrals.typeV1.toBuffer(referral)
  t.true(Buffer.isBuffer(buf), 'should be serializable into a buffer')
  const decoded = referrals.decode(buf)
  t.is(decoded.version, 1, 'should be version 1 by default')
  const obj = referrals.objectify(decoded)
  t.deepEqual(referral, obj, 'message input should match output')
})
