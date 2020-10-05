const avro = require('avro-js')
const { dateToISO } = require('bat-utils/lib/extras-utils')

const topic = process.env.ENV + '.promo.referral'
const v1 = avro.parse({
  // it is important to keep this as a group that is not reported live to preserve anonymity
  namespace: 'brave.payments',
  type: 'record',
  name: 'referral',
  doc: 'This message is sent when a referral is finalized by a service',
  fields: [
    { name: 'transactionId', type: 'string' },
    { name: 'channelId', type: 'string' },
    { name: 'ownerId', type: 'string' },
    { name: 'finalizedTimestamp', type: 'string' },
    { name: 'referralCode', type: 'string', default: '' },
    { name: 'downloadId', type: 'string' },
    { name: 'downloadTimestamp', type: 'string' },
    { name: 'countryGroupId', type: 'string', default: '' },
    { name: 'platform', type: 'string' }
  ]
})

module.exports = {
  topic,
  decode,
  encode,
  objectify,
  type: {
    v1
  }
}

function encode (obj) {
  return v1.toBuffer(Object.assign({}, obj, {
    finalizedTimestamp: dateToISO(obj.finalizedTimestamp),
    downloadTimestamp: dateToISO(obj.downloadTimestamp)
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
