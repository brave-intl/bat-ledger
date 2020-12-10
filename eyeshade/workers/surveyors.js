const {
  timeout
} = require('$/bat-utils/lib/extras-utils')
const { insertFromVoting } = require('../lib/transaction.js')

const freezeInterval = process.env.FREEZE_SURVEYORS_AGE_DAYS

const feePercent = 0.05

exports.name = 'surveyors'
exports.freezeOldSurveyors = freezeOldSurveyors

/*
  olderThanDays: int
*/
async function freezeOldSurveyors (debug, runtime, olderThanDays) {
  if (typeof olderThanDays === 'undefined') {
    olderThanDays = freezeInterval
  }

  const query = `
  select id from surveyor_groups
  where not frozen
  and not virtual
  and created_at < current_date - $1 * interval '1d'
  `

  const {
    rows: nonVirtualSurveyors
  } = await runtime.postgres.query(query, [olderThanDays], true)

  const virtualQuery = `
  select id from surveyor_groups
  where not frozen
  and virtual
  and created_at < current_date
  `

  const {
    rows: virtualSurveyors
  } = await runtime.postgres.query(virtualQuery, [], true)

  const toFreeze = nonVirtualSurveyors.concat(virtualSurveyors)
  for (let i = 0; i < toFreeze.length; i += 1) {
    const surveyorId = toFreeze[i].id
    await surveyorFrozenReport(null, runtime, { surveyorId, mix: true })
    await waitForTransacted(runtime, surveyorId)
  }
}

async function waitForTransacted (runtime, surveyorId) {
  let row
  const start = new Date()
  do {
    await timeout(5 * 1000)
    const statement = `
    select *
    from votes
    where
        surveyor_id = $1
    and not transacted
    limit 1`
    const { rows } = await runtime.postgres.query(statement, [surveyorId], true)
    row = rows[0]
    if (new Date() - (1000 * 60 * 60) > start) {
      runtime.captureException(new Error('unable to finish freezing process'), {
        extra: {
          surveyorId
        }
      })
      return
    }
  } while (row) // when no row is returned, all votes have been transacted
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

exports.mixer = mixer

exports.initialize = async (debug, runtime) => {
  try {
    await freezeOldSurveyors(debug, runtime)
  } catch (ex) {
    runtime.captureException(ex)
    debug('freeze old surveyors failed', {
      message: ex.message,
      stack: ex.stack
    })
  }
}

async function surveyorFrozenReport (debug, runtime, payload) {
  // FIXME should rework this
  const { postgres } = runtime
  const { mix, surveyorId } = payload

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
