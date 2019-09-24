const boom = require('@hapi/boom')
const {
  RateLimiterRedis
} = require('rate-limiter-flexible')
const _ = require('underscore')

const braveHapi = require('./extras-hapi')
const whitelist = require('./hapi-auth-whitelist')
const env = require('../../env')
const {
  GRAYLIST,
  TOKEN_LIST
} = env

const pluginName = 'rateLimitRedisPlugin'

module.exports = (runtime) => {
  const redisClient = (runtime.cache && runtime.cache.cache) || runtime.queue.config.client

  // const redisClient = redis.createClient({
  //   host: 'localhost',
  //   port: 6379,
  //   enable_offline_queue: false
  // })

  /*  access type            requests/minute per IP address
    -------------------    ------------------------------
    anonymous (browser)       60
    administrator (github)  3000
    server (bearer token)  60000
  */
  const rateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter',
    points: 3000, // requests
    duration: 60 // per second by IP
  })

  const rateLimiterWhitelisted = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter-whitelist',
    points: 60000, // requests
    duration: 60 // per second by IP
  })

  const noRateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'no-rate-limiter',
    points: Number.MAX_SAFE_INTEGER, // requests
    duration: 1 // per second by IP
  })

  const internals = {
    pluginName,
    redisClient,
    rateLimiter,
    rateLimiterWhitelisted,
    noRateLimiter
  }

  return {
    name: pluginName,
    version: '1.0.0',
    register: function (server) {
      server.ext('onPreAuth', async (request, h) => {
        const address = rateLimitKey(request)
        const rateLimiter = chooseRateLimiter(request)
        try {
          await rateLimiter.consume(address)
          return h.continue
        } catch (err) {
          let error
          if (err instanceof Error) {
            // If some Redis error and `insuranceLimiter` is not set
            error = boom.internal('Try later')
          } else {
            // Not enough points to consume
            error = boom.tooManyRequests('Rate limit exceeded')
            error.output.headers['Retry-After'] = Math.round(err.msBeforeNext / 1000) || 1
          }

          return error
        }
      })
    }
  }

  function chooseRateLimiter (request) {
    let authorization, parts, token

    try {
      const ipaddr = whitelist.ipaddr(request)
      if (ipaddr === '127.0.0.1') {
        return internals.noRateLimiter
      }

      if (GRAYLIST.methods.checkAuthed(ipaddr)) {
        return internals.noRateLimiter
      }

      if (whitelist.authorizedP(ipaddr)) {
        authorization = request.raw.req.headers.authorization
        if (authorization) {
          parts = authorization.split(/\s+/)
          token = (parts[0].toLowerCase() === 'bearer') && parts[1]
        } else {
          token = request.query.access_token
        }

        if (!_.isString(token)) {
          return internals.rateLimiter
        }

        if (!braveHapi.isSimpleTokenValid(TOKEN_LIST, token)) {
          return internals.rateLimiter
        }

        return internals.rateLimiterWhitelisted
      }
    } catch (e) {}

    return internals.rateLimiter
  }

  function rateLimitKey (request) {
    try {
      return whitelist.ipaddr(request) + ':' + runtime.config.server.host
    } catch (e) {
      return 'default'
    }
  }
}
