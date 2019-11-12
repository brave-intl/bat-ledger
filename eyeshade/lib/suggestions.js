const avro = require('avro-js')

module.exports.suggestionType = avro.parse({
  'namespace': 'brave.grants',
  'type': 'record',
  'name': 'suggestion',
  'doc': 'This message is sent when a client suggests to \'spend\' a grant',
  'fields': [
    { 'name': 'id', 'type': 'string' },
    { 'name': 'type', 'type': 'string' },
    { 'name': 'channel', 'type': 'string' },
    { 'name': 'createdAt', 'type': 'string' },
    { 'name': 'totalAmount', 'type': 'string' },
    { 'name': 'funding',
      'type': {
        'type': 'array',
        'items': {
          'type': 'record',
          'name': 'funding',
          'doc': 'This record represents a funding source, currently a promotion.',
          'fields': [
            { 'name': 'type', 'type': 'string' },
            { 'name': 'amount', 'type': 'string' },
            { 'name': 'cohort', 'type': 'string' },
            { 'name': 'promotion', 'type': 'string' }
          ]
        }
      }
    }
  ]
})
