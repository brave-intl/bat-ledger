const { votesId } = require('../lib/queries.js')
const { voteType } = require('../lib/vote.js')

const voteTopic = process.env.ENV + '.payment.vote'

module.exports = (runtime, callback) => {
  runtime.kafka.on(voteTopic, async (messages) => {
    const client = await runtime.postgres.connect()
    const now = new Date()
    const date = [
        now.getFullYear(),
        ((now.getMonth() + 1) + '').padStart(2, '0'),
        (now.getDate() + '').padStart(2, '0')
    ].join('-')

    try {
      await client.query('BEGIN')
      try {
        for (let message of messages) {
          const buf = Buffer.from(message.value, 'binary')
          let vote
          try {
            vote = voteType.fromBuffer(buf)
          } catch (e) {
            // If the event is not well formed, capture the error and continue
            runtime.captureException(e, { extra: { topic: voteTopic, message: message } })
            continue
          }

            const surveyorId = date + '_' + vote.fundingSource
            const cohort = "control"
            const tally = vote.voteTally
            const voteValue = vote.baseVoteValue
            const publisher = vote.channel
            const id = vote.id

            const surveyorUpdate = `
            insert into surveyor_groups (id, price, virtual) values ($1, $2, true)
            on conflict (id) do nothing;
            `
            await client.query(surveyorUpdate, [
              surveyorId,
              voteValue
            ])

            const voteUpdate = `
            insert into votes (id, cohort, tally, excluded, channel, surveyor_id) values ($1, $2, $3, $4, $5, $6)
            on conflict (id) do update set updated_at = current_timestamp, tally = votes.tally + $3;
            `
            await client.query(voteUpdate, [
              votesId(publisher, cohort, id),
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
        runtime.captureException(e, { extra: { topic: voteTopic } })
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
