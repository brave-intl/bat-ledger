const querystring = require('querystring')
const _ = require('underscore')
const wreck = require('wreck')

const { WreckProxy } = require('./extras-hapi')

module.exports = Wreck

function Wreck (config, runtime) {
  if (!(this instanceof Wreck)) {
    return new Wreck(config, runtime)
  }
  this.runtime = runtime
  this.config = config

  _.assign(this, _.mapObject(config.wreck, byDomain))
  return this
}

function byDomain (options) {
  const scopedWreck = wreck.defaults(options || {})
  return {
    get: normalizedWreckCall('get', scopedWreck, options),
    patch: normalizedWreckCall('patch', scopedWreck, options),
    post: normalizedWreckCall('post', scopedWreck, options),
    put: normalizedWreckCall('put', scopedWreck, options),
    delete: normalizedWreckCall('delete', scopedWreck, options)
  }
}

function normalizedWreckCall (method, scopedWreck, options) {
  return async (debug, path, passedOpts = {}) => {
    const { query } = passedOpts
    const filteredOpts = _.omit(passedOpts, ['query'])
    const fullpath = appendQueryString(path, query)
    const { opts } = WreckProxy(fullpath, filteredOpts)
    debug(fullpath, opts, options)
    return scopedWreck[method](fullpath, opts)
  }
}

function appendQueryString (path, query) {
  const qs = querystring.stringify(query)
  const append = qs ? `?${qs}` : ''
  return `${path}${append}`
}
