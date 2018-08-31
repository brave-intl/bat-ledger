const { URL } = require('url')

const Raven = require('raven')
const SDebug = require('sdebug')
const underscore = require('underscore')

const debug = new SDebug('sentry')

const release = process.env.HEROKU_SLUG_COMMIT || 'test'

const Sentry = function (config, runtime) {
  if (!(this instanceof Sentry)) return new Sentry(config, runtime)

  if (!config.sentry.dsn) {
    process.on('unhandledRejection', (ex) => {
      console.log(ex.stack)

      debug('sentry', ex)
    })
  }

  // NOTE If sentry dsn if falsey, events will be consumed without error
  //      with no attempt to send them
  Raven.config(config.sentry.dsn, {
    release,
    captureUnhandledRejections: true
  }).install()

  runtime.captureException = (ex, optional) => {
    if (optional && optional.req) {
      const request = optional.req
      optional.req = { // If present rewrite the request into sentry format
        method: request.method,
        query_string: request.query,
        headers: underscore.omit(request.headers, [ 'authorization', 'cookie' ])
      }
      try {
        const url = new URL(request.path, runtime.config.server)
        if (url) optional.req['url'] = url
      } catch (ex) { }
      optional.extra = underscore.extend(optional.extra, { timestamp: request.info.received, id: request.id })
    }
    Raven.captureException(ex, optional)
  }

  if (!config.sentry && process.env.NODE_ENV === 'production') {
    throw new Error('config.sentry undefined')
  }
}

module.exports = Sentry
