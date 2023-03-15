import test from 'ava'
import settlements from './settlements.js'
import utils from '../../test/utils.js'

test('settlements should be serializable and decodable without losing information', (t) => {
  const settlement = utils.settlement.create()
  const buf = settlements.encode(settlement)
  t.true(Buffer.isBuffer(buf), 'should be serializable into a buffer')
  const decoded = settlements.decode(buf)
  t.is(decoded.version, 2, 'should be version 1 by default')
  const obj = settlements.objectify(decoded)
  t.deepEqual(settlement, obj, 'message input should match output')
})
