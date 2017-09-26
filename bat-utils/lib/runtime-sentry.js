const { URL } = require('url')

const Raven = require('raven')
const underscore = require('underscore')

const Sentry = function (config, runtime) {
  if (!(this instanceof Sentry)) return new Sentry(config, runtime)

  // NOTE If sentry dsn if falsey, events will be consumed without error
  //      with no attempt to send them
  Raven.config(config.sentry.dsn, {
    captureUnhandledRejections: true
  }).install()

  runtime.captureException = (ex, optional) => {
    if (optional.req) {
      const request = optional.req
      optional.req = { // If present rewrite the request into sentry format
        method: request.method,
        query_string: request.query,
        url: new URL(request.path, runtime.config.server),
        headers: underscore.omit(request.headers, [ 'authorization', 'cookie' ])
      }
      optional.extra = underscore.extend(optional.extra, { timestamp: request.info.received, id: request.id })
    }
    Raven.captureException(ex, optional)
  }

  if (!config.sentry && process.env.NODE_ENV === 'production') {
    throw new Error('config.sentry undefined')
  }
}

module.exports = Sentry
