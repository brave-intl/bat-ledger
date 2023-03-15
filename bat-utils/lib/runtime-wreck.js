import querystring from 'querystring'
import _ from 'underscore'
import wreck from '@hapi/wreck'
import { WreckProxy } from './extras-hapi.js'

export default Wreck

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
    get: normalizedWreckCall('get', scopedWreck),
    patch: normalizedWreckCall('patch', scopedWreck),
    post: normalizedWreckCall('post', scopedWreck),
    put: normalizedWreckCall('put', scopedWreck),
    delete: normalizedWreckCall('delete', scopedWreck)
  }
}

function normalizedWreckCall (method, scopedWreck) {
  return async (debug, path, passedOpts = {}) => {
    const { query } = passedOpts
    const filteredOpts = _.omit(passedOpts, ['query'])
    const fullpath = appendQueryString(path, query)
    const { opts } = WreckProxy(fullpath, filteredOpts)
    return scopedWreck[method](fullpath, opts)
  }
}

function appendQueryString (path, query) {
  const qs = querystring.stringify(query)
  const append = qs ? `?${qs}` : ''
  return `${path}${append}`
}
