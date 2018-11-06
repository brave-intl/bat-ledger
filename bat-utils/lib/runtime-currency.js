const url = require('url')
const SDebug = require('sdebug')
const currencyCodes = require('currency-codes')
const braveHapi = require('./extras-hapi')
const NodeCache = require('node-cache')
const { BigNumber } = require('./extras-utils')
const _ = require('underscore')
const debug = new SDebug('currency')
let singleton

const mins5InSeconds = 5 * 60

const knownRateKeys = [
  'BTC',
  'ETH',
  'XRP',
  'BCH',
  'LTC',
  'DASH',
  'BTG',
  'USD',
  'EUR'
]
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

generateGlobal.knownRateKeys = knownRateKeys
generateGlobal.decimals = decimals

module.exports = generateGlobal

Currency.prototype = {
  decimals,
  knownRateKeys,
  access: async function (path) {
    const context = this
    const {
      config,
      cache
    } = context
    let {
      url: currencyUrl,
      access_token: accessToken
    } = config
    accessToken = accessToken || 'foobarfoobar'
    const baseUrl = url.resolve(currencyUrl, '/v1/')
    const endpoint = url.resolve(baseUrl, path)
    const cacheKey = `currency:${endpoint}`
    const cached = cache.get(cacheKey)
    if (cached) {
      return cached
    }
    const options = {
      useProxyP: true,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      }
    }
    try {
      const body = await braveHapi.wreck.get(endpoint, options)
      const dataString = body.toString()
      const data = JSON.parse(dataString)
      const { payload } = data
      cache.set(cacheKey, payload)
      return payload
    } catch (err) {
      context.captureException(err)
      throw err
    }
  },

  all: function () {
    return this.access('./')
  },

  rates: async function (against, currencies) {
    const rateCurrencies = currencies || knownRateKeys
    const context = this
    const rates = await context.all()
    const number = rates[against]
    const base = new BigNumber(number.toString())
    return _.reduce(rateCurrencies, (memo, key) => {
      const value = rates[key]
      const price = new BigNumber(value.toString())
      memo[key] = price.dividedBy(base).toNumber()
      return memo
    }, {})
  },

  ratio: function (a, b) {
    return this.access(`${a}/${b}`)
  },

  // satoshis, wei, etc.
  alt2scale: function (altcurrency) {
    const scale = this.decimals[altcurrency]

    if (scale) {
      return ('1e' + scale.toString())
    }
  },

  alt2fiat: async function (altcurrency, probi, currency, floatP) {
    let rate = await singleton.ratio(altcurrency, currency)
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

    let rate = await singleton.ratio(altcurrency, currency)
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

    return probi.floor().toString()
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
  context.config = conf
  context.runtime = runtime
  context.cache = new NodeCache({
    stdTTL: mins5InSeconds
  })
}
