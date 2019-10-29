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

// NOTE This function trusts the final IP address in X-Forwarded-For
//      This is reasonable only when running behind a load balancer that correctly sets this header
//      and there is no way to directly access the web nodes
// https://en.wikipedia.org/wiki/X-Forwarded-For    X-Forwarded-For: client, proxy1, proxy2
// Since it is easy to forge an X-Forwarded-For field the given information should be used with care.
// The last IP address is always the IP address that connects to the last proxy, which means it is the most reliable source of information.
exports.ipaddr = ipaddr
exports.validateHops = validateHops
exports.invalidHops = invalidHops
exports.forwardedIPShift = forwardedIPShift
exports.authenticate = authenticate
exports.plugin = {
  register: (server, options) => {
    server.auth.scheme('whitelist', internals.implementation)
    server.auth.strategy('whitelist', 'whitelist', {})
  },
  pkg: require(path.join(__dirname, '..', 'package.json'))
}

exports.authenticate = (request, h) => {
  const ipaddr = exports.ipaddr(request)

  if ((authorizedAddrs) &&
        (authorizedAddrs.indexOf(ipaddr) === -1) &&
        (!underscore.find(authorizedBlocks, (block) => { return block.contains(ipaddr) }))) return boom.notAcceptable()

  validateHops(request)

  if (h.authenticated) {
    return h.authenticated({ credentials: { ipaddr } })
  }
  return h.continue
}

exports.plugin = {
  pkg: require(path.join(__dirname, '..', 'package.json')),
  register: (server, options) => {
    server.auth.scheme('whitelist', internals.implementation)
    server.auth.strategy('whitelist', 'whitelist', {})
  }
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

function forwardedIPShift () {
  const shiftEnv = process.env.FORWARDED_IP_SHIFT
  const shift = shiftEnv ? (+shiftEnv) : 1
  if (underscore.isNaN(shift)) {
    throw new Error(`${JSON.stringify(shiftEnv)} is not a valid number`)
  }
  return shift >= 0 ? shift : 1
}
