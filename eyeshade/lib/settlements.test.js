const { serial: test } = require('ava')
const settlements = require('./settlements')
const utils = require('../../test/utils')

test('settlements should be serializable and decodable without losing information', (t) => {
  const settlement = utils.settlement.create()
  const buf = settlements.type.v1.toBuffer(settlement)
  t.true(Buffer.isBuffer(buf), 'should be serializable into a buffer')
  const decoded = settlements.decode(buf)
  t.is(decoded.version, 1, 'should be version 1 by default')
  const obj = settlements.objectify(decoded)
  t.deepEqual(settlement, obj, 'message input should match output')
})
