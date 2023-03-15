import avro from 'avro-js'
import { isUUID } from 'bat-utils/lib/extras-utils.js'

const typeV1 = avro.parse({
  namespace: 'brave.grants',
  type: 'record',
  name: 'suggestion',
  doc: 'This message is sent when a client suggests to \'spend\' a grant',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'channel', type: 'string' },
    { name: 'createdAt', type: 'string' },
    { name: 'totalAmount', type: 'string' },
    {
      name: 'funding',
      type: {
        type: 'array',
        items: {
          type: 'record',
          name: 'funding',
          doc: 'This record represents a funding source, currently a promotion.',
          fields: [
            { name: 'type', type: 'string' },
            { name: 'amount', type: 'string' },
            { name: 'cohort', type: 'string' },
            { name: 'promotion', type: 'string' }
          ]
        }
      }
    }
  ]
})
const typeV2 = avro.parse({
  namespace: 'brave.grants',
  type: 'record',
  name: 'suggestion',
  doc: 'This message is sent when a client suggests to \'spend\' a grant',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'channel', type: 'string' },
    { name: 'createdAt', type: 'string' },
    { name: 'totalAmount', type: 'string' },
    { name: 'orderId', type: 'string', default: '' },
    {
      name: 'funding',
      type: {
        type: 'array',
        items: {
          type: 'record',
          name: 'funding',
          doc: 'This record represents a funding source, currently a promotion.',
          fields: [
            { name: 'type', type: 'string' },
            { name: 'amount', type: 'string' },
            { name: 'cohort', type: 'string' },
            { name: 'promotion', type: 'string' }
          ]
        }
      }
    }
  ]
})
const orderIdOnly = avro.parse({
  namespace: 'brave.grants',
  type: 'record',
  name: 'suggestionOrderId',
  aliases: ['suggestion'],
  fields: [
    { name: 'orderId', type: 'string', default: '' }
  ]
})

const resolverV2 = orderIdOnly.createResolver(typeV2)

export default {
  typeV1,
  typeV2,
  decode
}

function decode (buf) {
  const orderIdRecord = orderIdOnly.fromBuffer(buf, resolverV2, true)
  if (isUUID(orderIdRecord.orderId)) {
    return {
      version: 2,
      suggestion: typeV2.fromBuffer(buf)
    }
  }
  try {
    return {
      version: 1,
      suggestion: typeV1.fromBuffer(buf)
    }
  } catch (e) {
    return {
      version: 2,
      suggestion: typeV2.fromBuffer(buf)
    }
  }
}
