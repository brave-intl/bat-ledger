const dns = require('dns')
const os = require('os')
const path = require('path')
const url = require('url')

const asyncHandler = require('hapi-async-handler')
const authBearerToken = require('hapi-auth-bearer-token')
const authCookie = require('hapi-auth-cookie')
const cryptiles = require('cryptiles')
const bell = require('bell')
const blipp = require('blipp')
const boom = require('boom')
const hapi = require('hapi')
const inert = require('inert')
const rateLimiter = require('hapi-rate-limiter')
const Raven = require('raven')
const SDebug = require('sdebug')
const swagger = require('hapi-swagger')
const underscore = require('underscore')
const vision = require('vision')

const braveHapi = require('./extras-hapi')
const whitelist = require('./hapi-auth-whitelist')

const Server = async (options, runtime) => {
  const debug = new SDebug('web')

  const server = new hapi.Server()

  server.connection({ port: process.env.PORT })

  if (!runtime) {
    runtime = options
    options = {}
  }
  underscore.defaults(options, { id: server.info.id, module: module, remoteP: true })
  if (!options.routes) options.routes = require('./controllers/index')

  debug.initialize({ web: { id: options.id } })

  if (process.env.NODE_ENV !== 'production') {
    process.on('warning', (warning) => {
      if (warning.name === 'DeprecationWarning') return

      debug('warning', underscore.pick(warning, [ 'name', 'message', 'stack' ]))
    })
  }

  server.register(
    [ bell,
      blipp,
      asyncHandler,
      authBearerToken,
      authCookie,
      whitelist,
      inert,
      vision,
      {
        register: rateLimiter,
        options: {
          defaultRate: (request) => {
/*  access type            requests/minute per IP address
    -------------------    ------------------------------
    anonymous (browser)       60
    administrator (github)  3000
    server (bearer token)  60000
 */
            const ipaddr = whitelist.ipaddr(request)
            let authorization, parts, token, tokenlist
            let limit = 60

            if (ipaddr === '127.0.0.1') return { limit: Number.MAX_SAFE_INTEGER, window: 1 }

            if (whitelist.authorizedP(ipaddr)) {
              authorization = request.raw.req.headers.authorization
              if (authorization) {
                parts = authorization.split(/\s+/)
                token = (parts[0].toLowerCase() === 'bearer') && parts[1]
              } else token = request.query.access_token
              tokenlist = process.env.TOKEN_LIST ? process.env.TOKEN_LIST.split(',') : []
              limit = (tokenlist.indexOf(token) !== -1) ? 60000 : 3000
            }

            return { limit: limit, window: 60 }
          },
          enabled: true,
          methods: [ 'get', 'post', 'delete', 'put', 'patch' ],
          overLimitError: (rate) => boom.tooManyRequests(`try again in ${rate.window} seconds`),
          rateLimitKey: (request) => whitelist.ipaddr(request) + ':' + runtime.config.server.hostname,
          redisClient: runtime.config.queue.client
        }
      },
      {
        register: swagger,
        options: {
          auth: {
            strategy: 'whitelist',
            mode: 'required'
          },
          info: {
            title: process.npminfo.name,
            version: process.npminfo.version,
            description: process.npminfo.description
          }
        }
      }
    ], (err) => {
    if (err) {
      debug('unable to register extensions', err)
      throw err
    }

    debug('extensions registered')

    if (runtime.login) {
      server.auth.strategy('github', 'bell', {
        provider: 'github',
        password: cryptiles.randomString(64),
        clientId: runtime.login.clientId,
        clientSecret: runtime.login.clientSecret,
        isSecure: runtime.login.isSecure,
        forceHttps: runtime.login.isSecure,
        scope: ['user:email', 'read:org']
      })
      debug('github authentication: forceHttps=' + runtime.login.isSecure)

      server.auth.strategy('session', 'cookie', {
        password: runtime.login.ironKey,
        cookie: 'sid',
        isSecure: runtime.login.isSecure
      })
      debug('session authentication strategy via cookie')
    } else {
      debug('github authentication disabled')
      if (process.env.NODE_ENV === 'production') {
        throw new Error('github authentication was not enabled yet we are in production mode')
      }

      const bearerAccessTokenConfig = {
        allowQueryToken: true,
        allowMultipleHeaders: false,
        validateFunc: (token, callback) => {
          const tokenlist = process.env.TOKEN_LIST && process.env.TOKEN_LIST.split(',')
          callback(null, ((!tokenlist) || (tokenlist.indexOf(token) !== -1)), { token: token, scope: ['devops', 'ledger', 'QA'] }, null)
        }
      }

      server.auth.strategy('session', 'bearer-access-token', bearerAccessTokenConfig)
      server.auth.strategy('github', 'bearer-access-token', bearerAccessTokenConfig)

      debug('session authentication strategy via bearer-access-token')
      debug('github authentication strategy via bearer-access-token')
    }

    server.auth.strategy('simple', 'bearer-access-token', {
      allowQueryToken: true,
      allowMultipleHeaders: false,
      validateFunc: (token, callback) => {
        const tokenlist = process.env.TOKEN_LIST && process.env.TOKEN_LIST.split(',')
        callback(null, ((!tokenlist) || (tokenlist.indexOf(token) !== -1)), { token: token }, null)
      }
    })
  })

  server.ext('onRequest', (request, reply) => {
    const remote = options.remoteP &&
          { address: whitelist.ipaddr(request), port: request.headers['x-forwarded-port'] || request.info.remotePort }

    if (request.headers['x-request-id']) request.id = request.headers['x-request-id']
    debug('begin', {
      sdebug: {
        request: {
          id: request.id,
          method: request.method.toUpperCase(),
          pathname: request.url.pathname
        },
        query: request.url.query,
        params: request.url.params,
        headers: underscore.omit(request.headers, [ 'authorization', 'cookie' ]),
        remote: remote
      }
    })

    return reply.continue()
  })

  server.ext('onPreResponse', (request, reply) => {
    const response = request.response

    if (runtime.config.sentry && request.response.statusCode >= 500) {
      const error = response

      Raven.captureException(error, {
        request: {
          method: request.method,
          query_string: request.query,
          url: url.format(runtime.config.server) + request.path
        },
        extra: { timestamp: request.info.received, id: request.id }
      })
    }

    if (process.env.NODE_ENV !== 'production' && response.isBoom) {
      const error = response

      error.output.payload.message = error.message
      if (error.body) {
        error.output.payload.body = error.body
      }
      error.output.payload.stack = error.stack

      return reply(error)
    }

    if ((!response.isBoom) || (response.output.statusCode !== 401)) {
      if (typeof response.header === 'function') response.header('Cache-Control', 'private')
      return reply.continue()
    }

    if (request && request.auth && request.cookieAuth && request.cookieAuth.clear) {
      request.cookieAuth.clear()
      reply.redirect('/v1/login')
    }

    return reply.continue()
  })

  server.on('log', (event, tags) => {
    debug(event.data, { tags: tags })
  }).on('request', (request, event, tags) => {
    debug(event.data, { tags: tags }, { sdebug: { request: { id: event.request, internal: event.internal } } })
  }).on('request-internal', (request, event, tags) => {
    let params

    if ((!tags) || (!tags.received)) return

    params = {
      request: {
        id: request.id,
        method: request.method.toUpperCase(),
        pathname: request.url.pathname
      },
      tags: tags
    }

    debug('begin', { sdebug: params })
  }).on('response', (request) => {
    const logger = request._logger || []
    const params = {
      request: {
        id: request.id,
        method: request.method.toUpperCase(),
        pathname: request.url.pathname,
        statusCode: request.response.statusCode
      },
      headers: request.response.headers,
      error: braveHapi.error.inspect(request.response._error)
    }

    if ((request.response.statusCode === 401) || (request.response.statusCode === 406)) {
      runtime.notify(debug, { text: JSON.stringify(underscore.extend({ address: whitelist.ipaddr(request) }, params.request)) })
    }

    logger.forEach((entry) => {
      if ((entry.data) && (typeof entry.data.msec === 'number')) { params.request.duration = entry.data.msec }
    })

    debug('end', { sdebug: params })
  })

  server.route(await options.routes.routes(debug, runtime, options))
  server.route({ method: 'GET', path: '/favicon.ico', handler: { file: './documentation/favicon.ico' } })
  server.route({ method: 'GET', path: '/favicon.png', handler: { file: './documentation/favicon.png' } })
  server.route({ method: 'GET', path: '/robots.txt', handler: { file: './documentation/robots.txt' } })
  if (process.env.ACME_CHALLENGE) {
    server.route({
      method: 'GET',
      path: '/.well-known/acme-challenge/' + process.env.ACME_CHALLENGE.split('.')[0],
      handler: (request, reply) => { reply(process.env.ACME_CHALLENGE) }
    })
  }
  // automated fishing expeditions shouldn't result in devops alerts...
  server.route({ method: 'GET', path: '/{path*}', handler: { file: './documentation/robots.txt' } })

  server.start((err) => {
    if (err) {
      debug('unable to start server', err)
      throw err
    }

    const children = {}
    let resolvers = underscore.uniq([ '8.8.8.8', '8.8.4.4' ].concat(dns.getServers()))

    const f = (m) => {
      m.children.forEach(entry => {
        const components = path.parse(entry.filename).dir.split(path.sep)
        const i = components.indexOf('node_modules')
        let p, version

        if (i >= 0) {
          p = components[i + 1]
          try {
            version = require(path.join(components.slice(0, i + 2).join(path.sep), 'package.json')).version
          } catch (ex) { return }

          if (!children[p]) children[p] = version
          else if (Array.isArray(children[p])) {
            if (children[p].indexOf(version) < 0) children[p].push(version)
          } else if (children[p] !== version) children[p] = [ children[p], version ]
        }
        f(entry)
      })
    }

    dns.setServers(resolvers)
    debug('webserver started',
          underscore.extend(
            { server: url.format(runtime.config.server), version: server.version, resolvers: resolvers },
            server.info,
            {
              env: underscore.pick(process.env, [ 'DEBUG', 'DYNO', 'NEW_RELIC_APP_NAME', 'NODE_ENV', 'BATUTIL_SPACES' ])
            }))
    process.npminfo.children = {}
    runtime.notify(debug, {
      text: os.hostname() + ' ' + process.npminfo.name + '@' + process.npminfo.version + ' started ' +
        (process.env.DYNO || 'web') + '/' + options.id
    })

    f(options.module)
    underscore.keys(children).sort().forEach(m => { process.npminfo.children[m] = children[m] })

    // Hook to notify start script.
    if (process.send) { process.send('started') }
  })

  return server
}

module.exports = Server
