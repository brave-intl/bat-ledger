const path = require('path')

const boom = require('boom')
const underscore = require('underscore')
const braveHapi = require('./extras-hapi')
const env = require('../../env')
const {
  WHITELIST
} = env

exports.authorizedP = WHITELIST.methods.checkAuthed

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

exports.validateHops = validateHops
exports.invalidHops = invalidHops
exports.forwardedIPShift = forwardedIPShift
exports.authenticate = authenticate

function authenticate (...args) {
  const [request, h] = args
  const ipaddr = exports.ipaddr(request)

  if (!WHITELIST.methods.checkAuthed(ipaddr)) {
    throw boom.notAcceptable()
  }

  // throws boomified
  validateHops(request)

  return h.continue
}

exports.register = (server, options) => {
  server.auth.scheme('whitelist', () => ({ authenticate }))
  server.auth.strategy('whitelist', 'whitelist', {})
}

exports.pkg = require(path.join(__dirname, '..', 'package.json'))

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
