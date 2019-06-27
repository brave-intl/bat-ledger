const path = require('path')

const boom = require('boom')
const Netmask = require('netmask').Netmask
const underscore = require('underscore')
const braveHapi = require('./extras-hapi')

const whitelist = process.env.IP_WHITELIST && process.env.IP_WHITELIST.split(',')

let authorizedAddrs = whitelist && [ '127.0.0.1' ]
let authorizedBlocks = whitelist && []

if (whitelist) {
  whitelist.forEach((entry) => {
    if ((entry.indexOf('/') !== -1) || (entry.split('.').length !== 4)) return authorizedBlocks.push(new Netmask(entry))

    authorizedAddrs.push(entry)
  })
}

const internals = {
  implementation: (server, options) => { return { authenticate: exports.authenticate } }
}

exports.authorizedP = (ipaddr) => {
  if ((authorizedAddrs) &&
        ((authorizedAddrs.indexOf(ipaddr) !== -1) ||
         (underscore.find(authorizedBlocks, (block) => { return block.contains(ipaddr) })))) return true
}

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
    const length = forwardedIps.length
    const shift = forwardedIPShift(length)
    const target = forwardedIps[length - shift]
    return target.trim() || request.info.remoteAddress
  } else {
    return request.info.remoteAddress
  }
}

exports.validateHops = validateHops
exports.invalidHops = invalidHops
exports.forwardedIPShift = forwardedIPShift

exports.authenticate = (request, reply) => {
  const ipaddr = exports.ipaddr(request)
  let result

  if ((authorizedAddrs) &&
        (authorizedAddrs.indexOf(ipaddr) === -1) &&
        (!underscore.find(authorizedBlocks, (block) => { return block.contains(ipaddr) }))) return reply(boom.notAcceptable())

  try {
    validateHops(request)
  } catch (e) {
    return reply(e)
  }

  try {
    result = reply.continue({ credentials: { ipaddr: ipaddr } })
  } catch (ex) {
    /* something odd with reply.continue not allowing any arguments... */
    result = reply.continue()
  }
  return result
}

exports.register = (server, options, next) => {
  server.auth.scheme('whitelist', internals.implementation)
  server.auth.strategy('whitelist', 'whitelist', {})
  next()
}

exports.register.attributes = {
  pkg: require(path.join(__dirname, '..', 'package.json'))
}

function invalidHops (err) {
  // can take an err
  return boom.boomify(err, {
    statusCode: 403,
    message: 'invalid fastly token supplied',
    decorate: Object.keys(err).map((key) => err[key])
  })
}

function validateHops (request) {
  const { headers } = request
  const token = headers['fastly-token']
  const { FASTLY_TOKEN_LIST } = process.env
  const fastlyTokens = (FASTLY_TOKEN_LIST && FASTLY_TOKEN_LIST.split(',')) || []
  const shift = forwardedIPShift()
  if (shift !== 1 && !braveHapi.isSimpleTokenValid(fastlyTokens, token)) {
    throw invalidHops({
      shift,
      token
    })
  }
}

function forwardedIPShift (max) {
  const shiftEnv = process.env.FORWARDED_IP_SHIFT
  const shift = shiftEnv ? (+shiftEnv) : 1
  if (underscore.isNaN(shift)) {
    throw new Error(`${JSON.stringify(shiftEnv)} is not a valid number`)
  }
  return shift >= 0 ? (!max || max >= shift ? shift : max) : 1
}
