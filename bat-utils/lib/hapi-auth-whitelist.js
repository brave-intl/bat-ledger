const path = require('path')

const boom = require('boom')
const Netmask = require('netmask').Netmask
const underscore = require('underscore')

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

exports.ipaddr = (request) => {
  return (request.headers['x-forwarded-for'] || request.info.remoteAddress).split(',')[0].trim()
}

exports.authenticate = (request, reply) => {
  const ipaddr = (request.headers['x-forwarded-for'] || request.info.remoteAddress).split(',')[0].trim()
  let result

  if ((authorizedAddrs) &&
        (authorizedAddrs.indexOf(ipaddr) === -1) &&
        (!underscore.find(authorizedBlocks, (block) => { return block.contains(ipaddr) }))) return reply(boom.notAcceptable())

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
