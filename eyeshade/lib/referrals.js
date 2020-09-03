const avro = require('avro-js')

const topic = process.env.ENV + '.promo.referral'
const typeV1 = avro.parse({
  // it is important to keep this as a group that is not reported live to preserve anonymity
  namespace: 'brave.payments',
  type: 'record',
  name: 'referral',
  doc: 'This message is sent when a referral is finalized by a service',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'transactionId', type: 'string' },
    { name: 'publisher', type: 'string' },
    { name: 'owner', type: 'string' },
    { name: 'altcurrency', type: 'string' },
    { name: 'createdAt', type: 'string' },
    {
      name: 'inputs',
      type: {
        type: 'array',
        items: {
          type: 'record',
          name: 'inputs',
          doc: 'This record represents a breakdown of referrals being transacted',
          fields: [
            { name: 'finalized', type: 'string' },
            { name: 'referralCode', type: 'string' },
            { name: 'downloadId', type: 'string' },
            { name: 'downloadTimestamp', type: 'string' },
            { name: 'countryGroupId', type: 'string' },
            { name: 'platform', type: 'string' },
            { name: 'payoutRate', type: 'string' },
            { name: 'probi', type: 'string' }
          ]
        }
      }
    }
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
  const objectified = Object.assign({}, message)
  objectified.inputs = objectified.inputs.map((input) =>
    Object.assign({}, input)
  )
  return objectified
}
