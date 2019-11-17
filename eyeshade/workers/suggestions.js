const { votesId } = require('../lib/queries.js')
const { suggestionType } = require('../lib/suggestions.js')
const BigNumber = require('bignumber.js')

const suggestionTopic = process.env.ENV + '.grant.suggestion'

module.exports = (runtime, callback) => {
  runtime.kafka.on(suggestionTopic, async (messages) => {
    const client = await runtime.postgres.connect()
    try {
      await client.query('BEGIN')
      try {
        for (let message of messages) {
          const buf = Buffer.from(message.value, 'binary')
          let suggestion
          try {
            suggestion = suggestionType.fromBuffer(buf)
          } catch (e) {
            // If the event is not well formed, capture the error and continue
            runtime.captureException(e, { extra: { topic: suggestionTopic, message: message } })
            continue
          }

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
        runtime.captureException(e, { extra: { topic: suggestionTopic } })
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
