const moment = require('moment')
const {
  timeout
} = require('bat-utils/lib/extras-utils')

const freezeInterval = process.env.FREEZE_SURVEYORS_AGE_DAYS

const feePercent = 0.05

const daily = async (debug, runtime) => {
  debug('daily', 'running')

  try {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)

    await freezeOldSurveyors(debug, runtime)
  } catch (ex) {
    runtime.captureException(ex)
    debug('daily', { reason: ex.toString(), stack: ex.stack })
  }

  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  setTimeout(() => { daily(debug, runtime) }, tomorrow - new Date())
  debug('daily', 'running again ' + moment(tomorrow).fromNow())
}

exports.name = 'reports'
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
    await runtime.queue.send(debug, 'surveyor-frozen-report', { surveyorId, mix: true })
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
  if (typeof freezeInterval === 'undefined' || isNaN(parseFloat(freezeInterval))) {
    throw new Error('FREEZE_SURVEYORS_AGE_DAYS is not set or not numeric')
  }

  if ((typeof process.env.DYNO === 'undefined') || (process.env.DYNO === 'worker.1')) {
    setTimeout(() => { daily(debug, runtime) }, 5 * 1000)
  }
}
