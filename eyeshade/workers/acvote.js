const { votesId } = require('../lib/queries.js')
const { voteType } = require('../lib/vote.js')
const moment = require('moment')
const { hasValidCountry } = require('../lib/publishers.js')

const voteTopic = process.env.ENV + '.payment.vote'

module.exports = (runtime) => {
  runtime.kafka.on(voteTopic, async (messages, client) => {
    const date = moment().format('YYYY-MM-DD')

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      const buf = Buffer.from(message.value, 'binary')
      let vote
      try {
        vote = voteType.fromBuffer(buf)
      } catch (e) {
        // If the event is not well formed, capture the error and continue
        runtime.captureException(e, { extra: { topic: voteTopic, message } })
        continue
      }


        await insertVote(runtime, date, vote, client)
    }
  })
}

module.exports.insertVote = insertVote

async function insertVote (runtime, date, vote, client, hasValidCountryFunc=hasValidCountry) {
  // Check if votes are for valid country
  if (await hasValidCountryFunc(runtime, vote.channel)) {
    const surveyorId = date + '_' + vote.fundingSource
    const cohort = 'control'
    const tally = vote.voteTally
    const voteValue = vote.baseVoteValue
    const publisher = vote.channel

    const surveyorUpdate = `
      insert into surveyor_groups (id, price, virtual) values ($1, $2, true)
      on conflict (id) do nothing;
      `
    await runtime.postgres.query(surveyorUpdate, [
      surveyorId,
      voteValue
    ], client)

    const voteUpdate = `
      insert into votes (id, cohort, tally, excluded, channel, surveyor_id) values ($1, $2, $3, $4, $5, $6)
      on conflict (id) do update set updated_at = current_timestamp, tally = votes.tally + $3
      returning *;
      `
    return runtime.postgres.query(voteUpdate, [
      votesId(publisher, cohort, surveyorId),
      cohort,
      tally,
      runtime.config.testingCohorts.includes(cohort),
      publisher,
      surveyorId
    ], client)
  }
}
