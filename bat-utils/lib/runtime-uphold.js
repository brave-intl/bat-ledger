const {
  default: SDK,
  RequestClient: Client
} = require('@uphold/uphold-sdk-javascript')
const querystring = require('querystring')
const url = require('url')
const {
  isUUID
} = require('./extras-utils')

class AlternativeClient extends Client {
  constructor (prometheus) {
    super()
    this.prometheus = prometheus
  }
  path (uri) {
    const parsed = url.parse(uri)
    let { path } = parsed
    const split = path.split('/')
    let cardinality = 'one'
    path = split.map((step) => {
      if (isUUID(step)) {
        cardinality = 'many'
        return '{id}'
      } else {
        return step
      }
    }).join('/')
    const {
      query,
      pathname
    } = url.parse(path)
    const partitions = querystring.parse(query)
    if (Object.keys(partitions).length) {
      cardinality = 'many'
    }
    return {
      path: pathname,
      partitions,
      cardinality
    }
  }
  async request (url, method, body, customHeaders = {}) {
    const { prometheus } = this
    const {
      path,
      partitions,
      cardinality
    } = this.path(url)
    const name = 'uphold_request_buckets_milliseconds'
    const options = Object.assign({}, partitions, {
      cardinality,
      method,
      path
    })
    const end = prometheus.timedRequest(name, options)
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
