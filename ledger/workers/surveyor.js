const cron = require('cron-parser')
const moment = require('moment')
const underscore = require('underscore')

const utilities = require('../controllers/surveyor.js')

let interval

const daily = async (debug, runtime) => {
  const surveyorType = 'contribution'
  const surveyors = runtime.database.get('surveyors', debug)

  debug('daily', 'running')

  const entries = await surveyors.find({ surveyorType: surveyorType, active: true }, { limit: 100, sort: { timestamp: -1 } })
  await Promise.all(entries.map(async (entry) => {
    let surveyor

    try {
      // FIXME capture these events w/ sentry
      const validity = utilities.validate(surveyorType, entry.payload)
      if (validity.error) return debug('daily', 'unable to create surveyorType=' + surveyorType + ': ' + validity.error)

      delete entry.payload.probi
      const payload = await utilities.enumerate(runtime, surveyorType, entry.payload)
      if (!payload) return debug('daily', 'no available currencies' + JSON.stringify(entry.payload))

      surveyor = await utilities.create(debug, runtime, surveyorType, payload)
      if (!surveyor) return debug('daily', 'unable to create surveyorType=' + surveyorType)
    } catch (ex) {
      return debug('daily', 'error ' + ex.toString() + ' ' + ex.stack)
    }

    runtime.notify(debug, {
      channel: '#ledger-bot',
      text: 'created ' + JSON.stringify(underscore.pick(surveyor, ['surveyorId', 'payload']))
    })
    debug('daily', 'created ' + surveyorType + ' surveyorID=' + surveyor.surveyorId)
  }))

  const next = interval.next().getTime()
  setTimeout(() => { daily(debug, runtime) }, next - underscore.now())
  debug('daily', 'running again ' + moment(next).fromNow())
}

exports.name = 'surveyor'
exports.initialize = async (debug, runtime) => {
  if ((typeof process.env.DYNO !== 'undefined') && (process.env.DYNO !== 'worker.1')) return

  await require('../controllers/registrar.js').initialize(debug, runtime)
  await utilities.initialize(debug, runtime)

  /* from https://github.com/harrisiirak/cron-parser

*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    |
│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, optional)

 */

  const schedule = process.env.SURVEYOR_CRON_SCHEDULE || '0 0 0 * * 0,3,5'

  interval = cron.parseExpression(schedule, {})
  const next = interval.next().getTime()
  setTimeout(() => { daily(debug, runtime) }, next - underscore.now())
  debug('daily', 'running ' + moment(next).fromNow())
}

exports.workers = {
}
