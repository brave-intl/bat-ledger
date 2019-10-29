const boom = require('@hapi/boom')
const Netmask = require('netmask').Netmask
const {
  RateLimiterRedis
} = require('rate-limiter-flexible')
const _ = require('underscore')
const underscore = _

const braveHapi = require('./extras-hapi')
const whitelist = require('./hapi-auth-whitelist')

const pluginName = 'rateLimitRedisPlugin'

const graylist = {
  addresses: process.env.IP_GRAYLIST && process.env.IP_GRAYLIST.split(',')
}

if (graylist.addresses) {
  graylist.authorizedAddrs = []
  graylist.authorizedBlocks = []

  graylist.addresses.forEach((entry) => {
    if ((entry.indexOf('/') === -1) && (entry.split('.').length === 4)) return graylist.authorizedAddrs.push(entry)

    graylist.authorizedBlocks.push(new Netmask(entry))
  })
}

module.exports = (runtime) => {
  const redisClient = (runtime.cache && runtime.cache.cache) || runtime.queue.config.client

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
  const rateLimiterAuthed = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter-authed',
    points: 3000, // requests per
    duration: 60 // seconds by IP
  })

  const rateLimiterWhitelisted = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter-whitelist',
    points: 60000, // requests per
    duration: 60 // seconds by IP
  })

  const rateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'rate-limiter',
    points: 60, // requests per
    duration: 60 // seconds by IP
  })

  const noRateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'no-rate-limiter',
    points: Number.MAX_SAFE_INTEGER, // requests per
    duration: 1 // seconds by IP
  })

  const internals = {
    pluginName,
    redisClient,
    rateLimiter,
    rateLimiterAuthed,
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

      if ((graylist.authorizedAddrs) &&
          ((graylist.authorizedAddrs.indexOf(ipaddr) !== -1) ||
           (underscore.find(graylist.authorizedBlocks, (block) => { return block.contains(ipaddr) })))) {
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

        const tokenlist = process.env.TOKEN_LIST ? process.env.TOKEN_LIST.split(',') : []
        if (typeof token === 'string' && braveHapi.isSimpleTokenValid(tokenlist, token)) {
          return internals.rateLimiterWhitelisted
        }

        return internals.rateLimiterAuthed
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
