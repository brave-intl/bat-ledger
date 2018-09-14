const url = require('url')
const SDebug = require('sdebug')
const currencyCodes = require('currency-codes')
const braveHapi = require('./extras-hapi')
const { BigNumber } = require('./extras-utils')
const debug = new SDebug('currency')
let singleton

const knownRateKeys = [
  'USD',
  'EUR',
  'BAT',
  'LTC',
  'BTC',
  'ETH'
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

const encodedRates = encodeURIComponent(knownRateKeys.join(','))
const rateCurrenciesQuery = `?currency=${encodedRates}`

generateGlobal.knownRateKeys = knownRateKeys
generateGlobal.decimals = decimals

module.exports = generateGlobal

Currency.prototype = {
  decimals,
  knownRateKeys,
  access: function (path) {
    const { config } = this
    let {
      url: currencyUrl,
      access_token: accessToken
    } = config
    accessToken = accessToken || 'foobarfoobar'
    let endpoint = url.resolve(currencyUrl, '/v1/')
    endpoint = url.resolve(endpoint, path)
    return braveHapi.wreck.get(endpoint, {
      useProxyP: true,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      }
    }).then((result) => {
      let data = result.toString()
      data = JSON.parse(data)
      return data.payload
    }).catch((err) => {
      this.captureException(err)
      throw err
    })
  },

  all: function () {
    return this.access('/')
  },

  rates: function (against) {
    return this.access(`relative/${against || 'USD'}${rateCurrenciesQuery}`)
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
}
