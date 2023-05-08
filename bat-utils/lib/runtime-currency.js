import { URL } from 'url'
import SDebug from 'sdebug'
import * as currencyCodes from 'currency-codes'
import * as braveHapi from './extras-hapi.js'
import { BigNumber } from './extras-utils.js'
import _ from 'underscore'

const debug = new SDebug('currency')
let singleton
const oneMin = 1000 * 60
const ms5min = 5 * oneMin
const failureDebounceTime = oneMin

const knownRateKeys = ['AED', 'ARS', 'AUD', 'BAT', 'BCH', 'BRL', 'BTC', 'BTG', 'CAD', 'CHF', 'CNY', 'DASH', 'DKK', 'ETH', 'EUR', 'GBP', 'HKD', 'ILS', 'INR', 'JPY', 'KES', 'LBA', 'LTC', 'MXN', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'USD', 'XAG', 'XAU', 'XPD', 'XPT', 'XRP']
// satoshis, wei, etc.
const decimals = {
  BAT: 18,
  BCH: 8,
  BTC: 8,
  ETC: 18,
  ETH: 18,
  LTC: 8,
  NMC: 8,
  PPC: 6,
  XPM: 8,
  ZEC: 8
}

const Cache = (cache = {}) => ({
  get: (key) => cache[key],
  set: (key, value) => {
    cache[key] = value
  }
})

let requestsInFlight = 0

generateGlobal.Cache = Cache
generateGlobal.knownRateKeys = knownRateKeys
generateGlobal.decimals = decimals

Currency.Cache = Cache

export default generateGlobal
generateGlobal.Constructor = Currency

Currency.prototype = {
  decimals,
  knownRateKeys,
  Cache,
  parser: function (buffer) {
    return JSON.parse(buffer.toString())
  },

  request: async function (endpoint) {
    if (requestsInFlight > (+process.env.RATIOS_CIRCUIT_BREAKER_LIMIT || 1)) {
      throw new Error('Circuit breaker triggered, skipping ratios request')
    }
    try {
      requestsInFlight++
      const context = this
      const {
        config
      } = context
      const {
        access_token: accessToken = 'foobarfoobar'
      } = config
      const authorization = `Bearer ${accessToken}`
      const options = {
        headers: {
          authorization,
          'content-type': 'application/json'
        }
      }
      return braveHapi.wreck.get(endpoint, options)
    } finally {
      requestsInFlight--
    }
  },

  access: async function (path) {
    const context = this
    const {
      config,
      cache
    } = context
    const {
      url: currencyUrl,
      updateTime,
      failureDebounceTime
    } = config
    const baseUrl = new URL('/v2/', currencyUrl)
    const endpoint = new URL(path, baseUrl)
    const cacheKey = `currency:${endpoint}`
    let data = cache.get(cacheKey)
    if (data) {
      const {
        lastUpdated,
        lastFailure,
        payload
      } = data
      const lastDate = new Date(lastUpdated)
      const lastAcceptableCache = new Date() - updateTime
      if (lastDate > lastAcceptableCache) {
        return payload
      }
      if (new Date(lastFailure) > (new Date()) - failureDebounceTime) {
        return payload
      }
    }
    try {
      const body = await context.request(endpoint.toString())
      data = context.parser(body)
    } catch (err) {
      context.captureException(err)
      if (data) {
        data.lastFailure = (new Date()).toISOString()
      }
    }
    cache.set(cacheKey, data)
    return data.payload
  },

  ratio: function (a, b) {
    return this.access(`relative/provider/coingecko/${a}/${b}/live`)
  },

  // satoshis, wei, etc.
  alt2scale: function (altcurrency) {
    if (!_.isString(altcurrency)) {
      return
    }

    const scale = this.decimals[altcurrency.toUpperCase()]

    if (scale) {
      return ('1e' + scale.toString())
    }
  },

  alt2fiat: async function (altcurrency, probi, currency, floatP) {
    const payload = await singleton.ratio(altcurrency, currency)
    const rate = payload[altcurrency.toLowerCase()][currency.toLowerCase()]
    if (!rate) {
      return
    }
    const entry = currencyCodes.code(currency)
    const scale = singleton.alt2scale(altcurrency)
    let amount

    if (!(probi instanceof BigNumber)) {
      probi = new BigNumber(probi.toString())
    }
    amount = probi.times(new BigNumber(rate.toString()))
    if (floatP) {
      return amount
    }

    if (scale) {
      amount = amount.dividedBy(scale)
    }

    return amount.toFixed(entry ? entry.digits : 2)
  },

  captureException: function (e) {
    debug('accessing currency ratios failed', {
      message: e.message,
      code: e.statusCode,
      stack: e.stack
    })
    this.runtime.captureException(e)
  },

  fiat2alt: async function (currency, amount, altcurrency) {
    if (!amount) {
      return
    }

    const payload = await singleton.ratio(altcurrency, currency)
    const rate = payload[altcurrency.toLowerCase()][currency.toLowerCase()]
    if (!rate) {
      return
    }

    const scale = singleton.alt2scale(altcurrency)
    let probi

    if (!(amount instanceof BigNumber)) {
      amount = new BigNumber(amount.toString())
    }
    probi = amount.dividedBy(new BigNumber(rate.toString()))

    if (scale) {
      probi = probi.times(scale)
    }

    return probi.integerValue(BigNumber.ROUND_FLOOR).toString()
  }
}

function generateGlobal (config, runtime) {
  if (!singleton) {
    singleton = new Currency(config, runtime)
  }
  return singleton
}

function Currency (config, runtime) {
  const context = this
  const conf = config.currency
  if (!conf.url) {
    throw new Error('currency ratios url is required')
  }
  context.config = Object.assign({
    updateTime: ms5min,
    failureDebounceTime
  }, conf)
  context.runtime = runtime
  context.debug = debug
  context.cache = Currency.Cache()
}
