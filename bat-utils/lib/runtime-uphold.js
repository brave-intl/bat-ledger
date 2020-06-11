const {
  default: SDK,
  RequestClient: Client
} = require('@uphold/uphold-sdk-javascript')
const SDebug = require('sdebug')
const debug = new SDebug('uphold')
const { URL } = require('url')
const {
  isUUID
} = require('./extras-utils')

class AlternativeClient extends Client {
  constructor (prometheus) {
    super()
    this.prometheus = prometheus
  }

  path (uri) {
    let { pathname: path } = new URL(uri)
    const split = path.split('/')
    let cardinality = 'one'
    path = split.map((step) => {
      if (isUUID(step)) {
        cardinality = 'many'
        return '{id}'
      } else {
        return step
      }
    })
    return {
      path: path.join('/'),
      cardinality
    }
  }

  async request (url, method, body, customHeaders = {}) {
    const { prometheus } = this
    const {
      path,
      cardinality
    } = this.path(url)
    const name = 'uphold_request_buckets_milliseconds'
    const end = prometheus.timedRequest(name, {
      cardinality,
      method,
      path
    })
    let err = null
    let result = {}
    try {
      result = await super.request(url, method, body, customHeaders)
    } catch (e) {
      err = e
    }
    const { status = 500 } = (err || result)
    end({ status })
    if (err) {
      debug({
        url,
        method,
        body,
        customHeaders,
        err
      })
      throw err
    }
    return result
  }
}

class ExtendedSDK extends SDK {
  constructor (prometheus, config) {
    super(config)

    this.client = new AlternativeClient(prometheus)
  }
}

module.exports = {
  default: ExtendedSDK
}
