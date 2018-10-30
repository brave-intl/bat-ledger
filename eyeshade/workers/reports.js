const moment = require('moment')

const daily = async (debug, runtime) => {
  const { database } = runtime

  debug('daily', 'running')

  try {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    await database.purgeSince(debug, runtime, midnight)
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

exports.initialize = async (debug, runtime) => {
  if ((typeof process.env.DYNO === 'undefined') || (process.env.DYNO === 'worker.1')) {
    setTimeout(() => { daily(debug, runtime) }, 5 * 1000)
  }
}
