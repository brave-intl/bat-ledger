const Raven = require('raven')

const Sentry = function (config, runtime) {
  if (!(this instanceof Sentry)) return new Sentry(config, runtime)

  if (config.sentry) {
    Raven.config(config.sentry.dsn).install()

    const chainNotify = runtime.notify
    runtime.notify = (debug, payload) => {
      if (chainNotify) {
        chainNotify(debug, payload)
      }
      Raven.captureMessage(payload.text)
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('config.sentry undefined')
  }
}

module.exports = Sentry
