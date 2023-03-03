import test from 'ava'
import referrals from './referrals.js'
import utils from '../../test/utils.js'

test('referrals should be serializable and decodable without losing information', (t) => {
  const referral = utils.referral.create()
  const buf = referrals.encode(referral)
  t.true(Buffer.isBuffer(buf), 'should be serializable into a buffer')
  const decoded = referrals.decode(buf)
  t.is(decoded.version, 1, 'should be version 1 by default')
  const obj = referrals.objectify(decoded)
  t.deepEqual(referral, obj, 'message input should match output')
})
