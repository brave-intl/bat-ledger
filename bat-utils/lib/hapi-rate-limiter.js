const boom = require('@hapi/boom')
const Netmask = require('netmask').Netmask
const {
  RateLimiterRedis
} = require('rate-limiter-flexible')
const _ = require('underscore')
const underscore = _

const pluginName = 'rateLimitRedisPlugin'
const braveHapi = require('./extras-hapi');

module.exports = (runtime) => {
  const redisClient = (runtime.cache && runtime.cache.cache)

  /*  access type            requests/minute per IP address
    -------------------    ------------------------------
    anonymous (browser)       60
    administrator (github)  3000
    server (bearer token)  60000
  */
  const rateLimiterAuthed = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter-authed',
    points: 3000, // requests per
    duration: 60 // seconds by IP
  })

  const rateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter',
    points: +process.env.ANON_RATE_LIMIT_PER_M || 60, // requests per
    duration: 60 // seconds by IP
  })

  const noRateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'no-rate-limiter',
    points: Number.MAX_SAFE_INTEGER, // requests per
    duration: 1 // seconds by IP
  })

  const globalRateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'global-limiter',
    points: +process.env.GLOBAL_RATE_LIMIT_PER_10S || 10000, // requests per
    duration: 10 // seconds
  })

  const internals = {
    pluginName,
    redisClient,
    rateLimiter,
    rateLimiterAuthed,
    noRateLimiter
  }

  return {
    name: pluginName,
    version: '1.0.0',
    register: function (server) {
      server.ext('onPostAuth', async (request, h) => {
        const address = rateLimitKey(request)
        const rateLimiter = chooseRateLimiter(request)
        let scope = null
        try {
          scope = rateLimiter._keyPrefix
          await rateLimiter.consume(address)
          scope = globalRateLimiter._keyPrefix
          await globalRateLimiter.consume('all')
          return h.continue
        } catch (err) {
          let error
          if (err instanceof Error) {
            // If some Redis error and `insuranceLimiter` is not set
            error = boom.internal('Try later')
          } else {
            // Not enough points to consume
            error = boom.tooManyRequests('Rate limit exceeded: ' + scope)
            error.output.headers['Retry-After'] = Math.round(err.msBeforeNext / 1000) || 1
          }

          return error
        }
      })
    }
  }

  function chooseRateLimiter (request) {
    try {
      if (process.env.NODE_ENV !== 'production') {
        return internals.noRateLimiter
      }

      return internals.rateLimiterAuthed
    } catch (e) {}

    return internals.rateLimiter
  }

  function rateLimitKey (request) {
    try {
      return braveHapi.ipaddr(request) + ':' + runtime.config.server.host
    } catch (e) {
      return 'default'
    }
  }
}
