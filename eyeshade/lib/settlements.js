const avro = require('avro-js')

const topic = process.env.ENV + '.settlement.payout'
const v1 = avro.parse({
  // it is important to keep this as a group that is not reported live to preserve anonymity
  namespace: 'brave.payments',
  type: 'record',
  name: 'payout',
  doc: 'This message is sent when settlement message is to be sent',
  fields: [
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

const v2 = avro.parse({
  // it is important to keep this as a group that is not reported live to preserve anonymity
  namespace: 'brave.payments',
  type: 'record',
  name: 'payout',
  doc: 'This message is sent when settlement message is to be sent',
  fields: [
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
    { name: 'type', type: 'string' },
    { name: 'hash', type: 'string' },
    { name: 'documentId', type: 'string' }
  ]
})

const hashOnly = avro.parse({
  namespace: 'brave.payments',
  type: 'record',
  name: 'payoutHash',
  aliases: ['payout'],
  fields: [
    { name: 'hash', type: 'string' }
  ]
})

const resolverV2 = hashOnly.createResolver(v2)

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
  if (!obj.documentId) {
    obj.documentId = ''
  }
  if (obj.hash) {
    return v2.toBuffer(obj)
  }
  return v1.toBuffer(obj)
}

function decode (buf) {
  try {
    const hashRecord = hashOnly.fromBuffer(buf, resolverV2, true)
    if (hashRecord.hash) {
      return decodeV2(buf)
    }
    return decodeV1(buf)
  } catch (e) {
    try {
      return decodeV1(buf)
    } catch (e) {
      return decodeV2(buf)
    }
  }
}

function decodeV1 (buf) {
  return {
    version: 1,
    message: v1.fromBuffer(buf)
  }
}

function decodeV2 (buf) {
  return {
    version: 2,
    message: v2.fromBuffer(buf)
  }
}

function objectify ({ message }) {
  return Object.assign({}, message)
}
