const crypto = require('crypto')
const ProxyAgent = require('proxy-agent')
const SDebug = require('sdebug')
const underscore = require('underscore')
const wreck = require('@hapi/wreck')

const npminfo = require('../npminfo')

exports.debug = (info, request) => {
  const debug = new SDebug(info.id)

  debug.initialize({ request: { id: request.id } })
  return debug
}

exports.domainCompare = (a, b) => {
  let d

  if (!a) a = ''
  a = a.split('.').reverse()
  if (!b) b = ''
  b = b.split('.').reverse()

  while (true) {
    if (a.length === 0) {
      return (b.length === 0 ? 0 : (-1))
    } else if (b.length === 0) return 1

    d = a.shift().localeCompare(b.shift())
    if (d !== 0) return (d < 0 ? (-1) : 1)
  }
}

const constantTimeEquals = (a, b) => {
  let mismatch = a.length !== b.length
  if (mismatch) {
    b = a
  }
  mismatch |= !crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  return !mismatch
}

exports.isSimpleTokenValid = (tokenList, token) => {
  if (!(Array.isArray(tokenList) && tokenList.every((element) => typeof element === 'string'))) {
    throw new TypeError('tokenList must be an array of strings')
  }
  if (typeof token !== 'string') {
    throw new TypeError('token must be a string')
  }

  for (let i = 0; i < tokenList.length; i++) {
    if (constantTimeEquals(tokenList[i], token)) {
      return true
    }
  }
  return false
}

const AsyncRoute = function () {
  if (!(this instanceof AsyncRoute)) return new AsyncRoute()

  this.internal = {}
  this.internal.method = 'GET'
  this.internal.path = '/'
  this.internal.extras = {}
}

AsyncRoute.prototype.get = function () {
  this.internal.method = 'GET'
  return this
}

AsyncRoute.prototype.method = function (method) {
  this.internal.method = method
  return this
}

AsyncRoute.prototype.post = function () {
  this.internal.method = 'POST'
  return this
}

AsyncRoute.prototype.put = function () {
  this.internal.method = 'PUT'
  return this
}

AsyncRoute.prototype.patch = function () {
  this.internal.method = 'PATCH'
  return this
}

AsyncRoute.prototype.delete = function () {
  this.internal.method = 'DELETE'
  return this
}

AsyncRoute.prototype.path = function (path) {
  this.internal.path = path
  return this
}

AsyncRoute.prototype.config = function (config) {
  if (typeof config === 'function') { config = { handler: config } }
  if (typeof config.handler === 'undefined') throw new Error('undefined handler for ' + JSON.stringify(this.internal))

  return (runtime) => {
    const payload = { handler: config.handler(runtime) }

    underscore.keys(config).forEach(key => {
      if ((key !== 'handler') && (typeof config[key] !== 'undefined')) payload[key] = config[key]
    })

    return {
      method: this.internal.method,
      path: this.internal.path,
      options: underscore.extend(payload, this.internal.extras)
    }
  }
}

exports.routes = { async: AsyncRoute }

const ErrorInspect = (err) => {
  if (!err) return

  const properties = ['message', 'isBoom', 'isServer']
  if (!err.isBoom) properties.push('stack')
  const i = underscore.pick(err, properties)
  if ((err.output) && (err.output.payload)) { underscore.defaults(i, { payload: err.output.payload }) }

  return i
}

exports.error = { inspect: ErrorInspect }

let wreckUA = ''
if (npminfo) {
  wreckUA += npminfo.name + '/' + npminfo.version + ' wreck/' + npminfo.dependencies.wreck
}

underscore.keys(process.versions).forEach((version) => { wreckUA += ' ' + version + '/' + process.versions[version] })

const WreckProxy = (server, opts) => {
  if (!opts) opts = {}
  if (!opts.headers) opts.headers = {}
  if (!opts.headers['user-agent'] && !opts.headers['User-Agent']) opts.headers['user-agent'] = wreckUA

  underscore.keys(opts.headers).forEach((header) => {
    if (typeof opts.headers[header] !== 'string') delete opts.headers[header]
  })

  if (typeof opts.useProxyP === 'undefined') return { server, opts }

  const useProxyP = opts.useProxyP
  opts = underscore.omit(opts, ['useProxyP'])
  if ((!useProxyP) || (!process.env.FIXIE_URL)) return { server, opts }

  return { server, opts: underscore.extend(opts, { agent: new ProxyAgent(process.env.FIXIE_URL) }) }
}
exports.WreckProxy = WreckProxy

const WreckGet = async (server, opts) => {
  const params = WreckProxy(server, opts)
  const { res, payload } = await wreck.get(params.server, params.opts) // eslint-disable-line no-unused-vars
  return payload
}

const WreckPost = async (server, opts) => {
  const params = WreckProxy(server, opts)
  const { res, payload } = await wreck.post(params.server, params.opts) // eslint-disable-line no-unused-vars
  return payload
}

const WreckPut = async (server, opts) => {
  const params = WreckProxy(server, opts)
  const { res, payload } = await wreck.put(params.server, params.opts) // eslint-disable-line no-unused-vars
  return payload
}

const WreckPatch = async (server, opts) => {
  const params = WreckProxy(server, opts)
  const { res, payload } = await wreck.patch(params.server, params.opts) // eslint-disable-line no-unused-vars
  return payload
}

const WreckDelete = async (server, opts) => {
  const params = WreckProxy(server, opts)
  const { res, payload } = await wreck.delete(params.server, params.opts) // eslint-disable-line no-unused-vars
  return payload
}

function forwardedIPShift () {
  const shiftEnv = process.env.FORWARDED_IP_SHIFT
  const shift = shiftEnv ? (+shiftEnv) : 1
  if (underscore.isNaN(shift)) {
    throw new Error(`${JSON.stringify(shiftEnv)} is not a valid number`)
  }
  return shift >= 0 ? shift : 1
}

exports.wreck = { get: WreckGet, patch: WreckPatch, post: WreckPost, put: WreckPut, delete: WreckDelete }

// NOTE This function trusts the final IP address in X-Forwarded-For
//      This is reasonable only when running behind a load balancer that correctly sets this header
//      and there is no way to directly access the web nodes
exports.ipaddr = (request) => {
  // https://en.wikipedia.org/wiki/X-Forwarded-For    X-Forwarded-For: client, proxy1, proxy2
  // Since it is easy to forge an X-Forwarded-For field the given information should be used with care.
  // The last IP address is always the IP address that connects to the last proxy, which means it is the most reliable source of information.

  const { headers } = request
  const forwardedFor = headers['x-forwarded-for']
  if (forwardedFor) {
    const forwardedIps = forwardedFor.split(',')
    const shift = forwardedIPShift()
    const target = forwardedIps[forwardedIps.length - shift]
    return target.trim() || request.info.remoteAddress
  } else {
    return request.info.remoteAddress
  }
}
