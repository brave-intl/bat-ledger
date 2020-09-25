const avro = require('avro-js')

const topic = process.env.ENV + '.settlement.payout'
const typeV1 = avro.parse({
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
    { name: 'createdAt', type: 'string' },
    { name: 'owner', type: 'string' },
    { name: 'probi', type: 'string' },
    { name: 'fees', type: 'string' },
    { name: 'type', type: 'string' }
  ]
})

module.exports = {
  topic,
  typeV1,
  decode,
  objectify
}

function decode (buf) {
  return {
    version: 1,
    message: typeV1.fromBuffer(buf)
  }
}

function objectify ({ message }) {
  return Object.assign({}, message)
}
