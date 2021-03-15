const { insertFromVoting } = require('../lib/transaction.js')

const feePercent = 0.05

exports.surveyorFrozenReport = async (debug, runtime, payload) => {
  // FIXME should rework this
  const { postgres } = runtime
  const { mix, surveyorId } = payload

  debug('freezing %o', payload)
  const client = await runtime.postgres.connect()
  try {
    await client.query('BEGIN')

    const updateSurveyorsStatement = 'update surveyor_groups set frozen = true, updated_at = current_timestamp where id = $1 returning created_at'
    const { rows: surveyors } = await postgres.query(updateSurveyorsStatement, [surveyorId], client)
    if (surveyors.length !== 1) {
      throw new Error('surveyor does not exist')
    }
    const surveyorCreatedAt = surveyors[0].created_at

    if (mix) {
      await mixer(runtime, client, surveyorId)
    }

    const countVotesStatement = `
    select
      votes.channel,
      coalesce(sum(votes.amount), 0.0) as amount,
      coalesce(sum(votes.fees), 0.0) as fees
    from votes where surveyor_id = $1::text and not excluded and not transacted and amount is not null
    group by votes.channel
    `
    const votingQ = await runtime.postgres.query(countVotesStatement, [surveyorId], client)
    if (!votingQ.rowCount) {
      throw new Error('no votes for this surveyor!')
    }
    const docs = votingQ.rows
    try {
      for (let i = 0; i < docs.length; i += 1) {
        await insertFromVoting(runtime, client, Object.assign(docs[i], { surveyorId }), surveyorCreatedAt)
      }
      const markVotesTransactedStatement = `
      update votes
        set transacted = true
      from
      (select votes.id
        from votes join transactions
        on (transactions.document_id = votes.surveyor_id and transactions.to_account = votes.channel)
        where not votes.excluded and votes.surveyor_id = $1
      ) o
      where votes.id = o.id
      `
      await runtime.postgres.query(markVotesTransactedStatement, [surveyorId], client)

      await client.query('COMMIT')
    } catch (e) {
      console.log(e)
      await client.query('ROLLBACK')
      runtime.captureException(e, { extra: { report: 'surveyor-frozen-report', surveyorId } })
      throw e
    }
  } catch (e) {
    console.log(e)
    runtime.captureException(e, {
      extra: {
        surveyorId
      }
    })
    throw e
  } finally {
    client.release()
  }
}

const mixer = async (runtime, client, surveyorId) => {
  const query = `
  update votes
  set
    amount = (1 - $1::decimal) * votes.tally * surveyor_groups.price,
    fees =  $1::decimal * votes.tally * surveyor_groups.price
  from surveyor_groups
  where
      votes.surveyor_id = surveyor_groups.id
  and votes.surveyor_id = $2
  and not votes.excluded
  and surveyor_groups.frozen
  `
  return runtime.postgres.query(query, [feePercent, surveyorId], client)
}
