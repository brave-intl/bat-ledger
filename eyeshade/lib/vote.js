const avro = require('avro-js')

module.exports.voteType = avro.parse({
  namespace: 'brave.payments',
  type: 'record',
  name: 'vote',
  doc: 'This message is sent when a user funded wallet has successfully auto-contributed to a channel',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'channel', type: 'string' },
    { name: 'createdAt', type: 'string' },
    { name: 'baseVoteValue', type: 'string', default: '0.25' },
    { name: 'voteTally', type: 'long', default: 1 },
    { name: 'fundingSource', type: 'string', default: 'uphold' }
  ]
})
