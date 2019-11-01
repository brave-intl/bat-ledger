const { votesId } = require('../lib/queries.js')
const avro = require('avro-js')
const BigNumber = require('bignumber.js')

const suggestionType = avro.parse({
  'namespace': 'brave.grants',
  'type': 'record',
  'name': 'suggestion',
  'doc': "This message is sent when a client suggests to 'spend' a grant",
  'fields': [
    { 'name': 'type', 'type': 'string' },
    { 'name': 'channel', 'type': 'string' },
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

module.exports = (runtime, callback) => {
  runtime.kafka.on('grant-suggestions', async (messages) => {
    const client = await runtime.postgres.connect()
    try {
      await client.query('BEGIN')
      try {
        for (let message of messages) {
          const buf = Buffer.from(message.value, 'binary')
          const suggestion = suggestionType.fromBuffer(buf)

          console.log(suggestion)

          const publisher = suggestion.channel
          for (let source of suggestion.funding) {
            // FIXME
            const voteValue = '0.25'

            const surveyorId = source.promotion // abuse promotion id as surveyor id

            const surveyorUpdate = `
            insert into surveyor_groups (id, price) values ($1, $2)
            on conflict (id) do nothing;
            `
            await client.query(surveyorUpdate, [
              surveyorId,
              voteValue
            ])

            const cohort = source.type

            const tally = new BigNumber(source.amount).dividedBy(voteValue).toString()

            const voteUpdate = `
            insert into votes (id, cohort, tally, excluded, channel, surveyor_id) values ($1, $2, $3, $4, $5, $6)
            on conflict (id) do update set updated_at = current_timestamp, tally = votes.tally + $3;
            `
            await client.query(voteUpdate, [
              votesId(publisher, cohort, surveyorId),
              cohort,
              tally,
              runtime.config.testingCohorts.includes(cohort),
              publisher,
              surveyorId
            ])
          }
        }
      } catch (e) {
        await client.query('ROLLBACK')
        runtime.captureException(e, { extra: { topic: 'grant-suggestions' } })
        throw e
      }
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    if (callback) {
      callback()
    }
  })
}
