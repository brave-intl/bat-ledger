const avro = require('avro-js')
const { dateToISO } = require('bat-utils/lib/extras-utils')

const topic = process.env.ENV + '.settlement.payout'
const v1 = avro.parse({
  // it is important to keep this as a group that is not reported live to preserve anonymity
  namespace: 'brave.payments',
  type: 'record',
  name: 'payout',
  doc: 'This message is sent when settlement message is to be sent',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'address', type: 'string' },
    { name: 'settlementId', type: 'string' },
    { name: 'publisher', type: 'string' },
    { name: 'altcurrency', type: 'string' },
    { name: 'currency', type: 'string' },
    { name: 'owner', type: 'string' },
    { name: 'probi', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fee', type: 'string' },
    { name: 'commission', type: 'string' },
    { name: 'fees', type: 'string' },
    { name: 'type', type: 'string' }
  ]
})

module.exports = {
  topic,
  encode,
  decode,
  objectify,
  type: {
    v1
  }
}

function encode (obj) {
  return v1.toBuffer(Object.assign({}, obj, {
    createdAt: dateToISO(obj.createdAt)
  }))
}

function decode (buf) {
  return {
    version: 1,
    message: v1.fromBuffer(buf)
  }
}

function objectify ({ message }) {
  return Object.assign({}, message)
}
