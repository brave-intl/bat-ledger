const { votesId } = require('../lib/queries.js')
const suggestions = require('../lib/suggestions.js')
const moment = require('moment')
const { BigNumber } = require('bat-utils/lib/extras-utils')

const suggestionTopic = process.env.ENV + '.grant.suggestion'

module.exports = (runtime) => {
  runtime.kafka.on(suggestionTopic, async (messages, client) => {
    const date = moment().format('YYYY-MM-DD')
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      const buf = Buffer.from(message.value, 'binary')
      let suggestion
      try {
        ;({ suggestion } = suggestions.decode(buf))
      } catch (e) {
        // If the event is not well formed, capture the error and continue
        runtime.captureException(e, { extra: { topic: suggestionTopic, message } })
        continue
      }

      const publisher = suggestion.channel
      for (let j = 0; j < suggestion.funding.length; j += 1) {
        const source = suggestion.funding[j]
        // FIXME
        const voteValue = '0.25'

        const surveyorId = date + '_' + source.promotion // abuse promotion id as surveyor id

        const surveyorUpdate = `
        insert into surveyor_groups (id, price, virtual) values ($1, $2, true)
        on conflict (id) do nothing;
        `
        await runtime.postgres.query(surveyorUpdate, [
          surveyorId,
          voteValue
        ], client)

        const cohort = source.type

        const tally = new BigNumber(source.amount).dividedBy(voteValue).toString()

        const voteUpdate = `
        insert into votes (id, cohort, tally, excluded, channel, surveyor_id) values ($1, $2, $3, $4, $5, $6)
        on conflict (id) do update set updated_at = current_timestamp, tally = votes.tally + $3;
        `
        await runtime.postgres.query(voteUpdate, [
          votesId(publisher, cohort, surveyorId),
          cohort,
          tally,
          runtime.config.testingCohorts.includes(cohort),
          publisher,
          surveyorId
        ], client)
      }
    }
  })
}
