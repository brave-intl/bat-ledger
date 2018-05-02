const BigNumber = require('bignumber.js')
const Bitfinex = require('bitfinex-api-node')
const Joi = require('joi')
const NodeCache = require('node-cache')
const Promise = require('bluebird')
const SDebug = require('sdebug')
const WebSocket = require('faye-websocket')
const binance = require('node-binance-api')
const currencyCodes = require('currency-codes')
const debug = new SDebug('currency')
const oxr = require('oxr')
const underscore = require('underscore')

const braveHapi = require('./extras-hapi')

const fiats = [ 'USD', 'EUR' ]

const msecs = {
  day: 24 * 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
  second: 1000
}

let client2
let client3

let flatlineP
let singleton

const Currency = function (config, runtime) {
  if (!(this instanceof Currency)) return new Currency(config, runtime)

  if (!config.currency || config.currency.static) return

  this.config = config.currency
  this.runtime = runtime

  this.informs = 0
  this.warnings = 0
  this.cache = new NodeCache({ stdTTL: 1 * msecs.minute })

  this.fiats = {}
  this.tickers = {}

  this.altrates = Currency.prototype.altrates
  this.fxrates = Currency.prototype.fxrates
  this.rates = Currency.prototype.rates

  if (!this.config.altcoins) this.config.altcoins = [ 'BAT', 'ETH' ]
  if ((this.config.altcurrency) && (this.config.altcoins.indexOf(this.config.altcurrency) === -1)) {
    this.config.altcoins.push(this.config.altcurrency)
  }
  this.config.allcoins = underscore.clone(this.config.altcoins)
  fiats.forEach((fiat) => {
    if (this.config.allcoins.indexOf(fiat) === -1) {
      this.config.allcoins.push(fiat)
    }
    this.fiats[fiat] = true
  })
}

Currency.prototype.schemas = {
  rates: Joi.object().keys({
    altrates: Joi.object().keys({}).pattern(/^[0-9A-Z]{2,}$/,
                                            Joi.object().keys({}).pattern(/^[0-9A-Z]{2,}$/,
                                                                          Joi.number().positive())).optional(),

    fxrates: Joi.object().keys({
      rates: Joi.object().keys({}).pattern(/^[0-9A-Z]{2,}$/, Joi.number().positive()).required()
    }).unknown(true).optional(),

    rates: Joi.object().keys({}).pattern(/^[0-9A-Z]{2,}$/,
                                         Joi.object().keys({}).pattern(/^[0-9A-Z]{2,}$/,
                                                                       Joi.number().positive())).optional()
  }).required()
}

Currency.prototype.altrates = {}
Currency.prototype.fxrates = { rates: {} }
Currency.prototype.rates = {}

Currency.prototype.init = function () {
  const self = this

  self.config.altcoins.forEach((altcoin) => {
    const f = altcoins[altcoin]

    if ((f) && (f.p)) f.p(self.config, self.runtime)
  })

  setInterval(function () { maintenance(self.config, self.runtime) }, 1 * msecs.minute)

  if (self.config.helper) return maintenance(self.config, self.runtime)

  monitor1(self.config, self.runtime)
  monitor2(self.config, self.runtime)
  monitor3(self.config, self.runtime)
  monitor4(self.config, self.runtime)
}

const schemaBINANCE =
      Joi.object().keys({
        e: Joi.string().required(),
        s: Joi.string().regex(/^[0-9A-Z]{2,}[0-9A-Z]{2,}$/).required(),
        p: Joi.number().positive().required()
      }).unknown(true).required()

const monitor1 = (config, runtime) => {
  const symbols = []

  config.altcoins.forEach((altcoin) => {
    if ((altcoin === 'BTG') || (altcoin === 'DASH')) return

    if (altcoin === 'BTC') symbols.push('BTC-USDT')
    else if (altcoin === 'ETH') symbols.push('ETH-USDT', 'ETH-BTC')
    else if (altcoin === 'BCH') symbols.push('BCC-BTC')
    else symbols.push(altcoin + '-BTC')
  })
  debug('monitor1', { symbols: symbols })

  symbols.forEach((symbol) => { monitor1a(symbol.split('-').join(''), false, config, runtime) })
}

const monitor1a = (symbol, retryP, config, runtime) => {
  if (retryP) debug('monitor1', { symbol: symbol, retryP: retryP })

  binance.websockets.subscribe(symbol.toLowerCase() + '@aggTrade', (trade) => {
    const validity = Joi.validate(trade, schemaBINANCE)
    const symbol = trade.s
    const src = symbol.substr(0, 3)
    let dst = symbol.substr(3)

    if (validity.error) return runtime.captureException(validity.error, { extra: { trade: trade } })

    flatlineP = false
    if (dst === 'USDT') dst = 'USD'
    if ((trade.e !== 'aggTrade') || (src === dst) || (config.allcoins.indexOf(src) === -1) ||
        (config.allcoins.indexOf(dst) === -1)) {
      return
    }

    trade.p = parseFloat(trade.p)
    if (!singleton.altrates[src]) singleton.altrates[src] = {}
    singleton.altrates[src][dst] = trade.p

    if (!singleton.altrates[dst]) singleton.altrates[dst] = {}
    singleton.altrates[dst][src] = 1.0 / trade.p

    Currency.prototype.altrates = singleton.altrates
  }, () => { setTimeout(function () { monitor1a(symbol, true, config, runtime) }, 15 * msecs.second) })
}

const altcoins = {
  _internal: {
    f: async (altcoin, tickers, config, runtime) => {
      const fiats = singleton.cache.get('fiats:' + altcoin)
      const rates = {}
      const unavailable = []
      let now, rate, target

      if (!fiats) return

      fiats.forEach((fiat) => {
        if ((altcoin !== 'BTC') && (fiat !== 'USD')) return

        rate = singleton.cache.get('ticker:' + altcoin + fiat)
        rates[fiat] = rate || (unavailable.push(fiat) && undefined)
      })
      if (unavailable.length > 0) {
        return runtime.captureException(altcoin + '.f fiat error: ' + unavailable.join(', ') + ' unavailable')
      }

      target = {}
      target[altcoin] = rates
      try { await rorschach(target, tickers, config, runtime) } catch (ex) {
        now = underscore.now()
        if (singleton.warnings > now) return

        singleton.warnings = now + (15 * msecs.minute)
        return runtime.captureException(ex)
      }
    }
  },

  BAT: {
    id: 'basic-attention-token'
  },

  BCH: {
    id: 'bitcoin-cash'
  },

  BTC: {
    id: 'bitcoin',

    f: async (tickers, config, runtime) => {
      return altcoins._internal.f('BTC', tickers, config, runtime)
    }
  },

  BTG: {
    id: 'bitcoin-gold'
  },

  DASH: {
    id: 'dash'
  },

  ETH: {
    id: 'ethereum',

    f: async (tickers, config, runtime) => {
      return altcoins._internal.f('ETH', tickers, config, runtime)
    }
  },

  LTC: {
    id: 'litecoin',

    f: async (tickers, config, runtime) => {
      return altcoins._internal.f('LTC', tickers, config, runtime)
    }
  },

  XRP: {
    id: 'ripple'
  }
}

const schemaGDAX =
      Joi.object().keys({
        type: Joi.any().required(),
        product_id: Joi.string().regex(/^[0-9A-Z]{2,}-[0-9A-Z]{2,}$/).required(),
        price: Joi.number().positive().required()
      }).unknown(true).required()

const monitor2 = (config, runtime) => {
  const query = []
  const symbols = []

  const retry = () => {
    try { if (client2) client2.end() } catch (ex) { debug('monitor2', { event: 'end', message: ex.toString() }) }

    client2 = undefined
    setTimeout(function () { monitor2(config, runtime) }, 15 * msecs.second)
  }

  if (client2) return

  config.altcoins.forEach((altcoin) => {
    const eligible = []
// not really convenient to retrieve /currencies in this method...
    const possibles = [ 'BCH', 'BTC', 'ETH', 'LTC', 'EUR', 'GBP', 'USD' ]

    if ((possibles.indexOf(altcoin) === -1) || (!altcoins[altcoin])) return

    if (altcoin !== 'BTC') {
      query.push({ type: 'subscribe', product_id: altcoin + '-BTC' })
      symbols.push(altcoin + '-BTC')
    }

    fiats.forEach((fiat) => {
      if (possibles.indexOf(fiat) === -1) return

      query.push({ type: 'subscribe', product_id: altcoin + '-' + fiat })
      symbols.push(altcoin + '-' + fiat)
      eligible.push(fiat)
    })

    singleton.cache.set('fiats:' + altcoin, eligible)
  })
  debug('monitor2', { symbols: symbols })

  client2 = new WebSocket.Client('wss://ws-feed.gdax.com/')
  client2.on('open', (event) => {
    debug('monitor2', { event: 'connected', connected: true })
  })
  client2.on('close', (event) => {
    if (event.code !== 1000) {
      debug('monitor2', underscore.extend({ event: 'disconnected' }, underscore.pick(event, [ 'code', 'reason' ])))
    }
    retry()
  })
  client2.on('error', (event) => {
    debug('monitor2', { event: 'error', message: event.message })
    retry()
  })
  client2.on('message', (event) => {
    let data, validity

    if (typeof event.data === 'undefined') {
      retry()
      return runtime.captureException(new Error('no event.data'))
    }

    try { data = JSON.parse(event.data) } catch (ex) {
      retry()
      return runtime.captureException(ex)
    }

    if ((typeof data.type === 'undefined') ||
        (typeof data.price === 'undefined') ||
        (data.type !== 'done') ||
        (data.side !== 'sell') ||
        (data.reason !== 'filled')) {
      return
    }

    validity = Joi.validate(data, schemaGDAX)
    if (validity.error) {
      retry()
      return runtime.captureException(validity.error, { extra: { data: data } })
    }

    singleton.cache.set('ticker:' + data.product_id.replace('-', ''), parseFloat(data.price))
  })
  try {
    query.forEach((symbol) => { client2.send(JSON.stringify(symbol)) })
  } catch (ex) {
    retry()
    return runtime.captureException(ex)
  }
}

const paramsBITFINEX = {
  BID: Joi.any().required(),
  BID_SIZE: Joi.any().required(),
  ASK: Joi.any().required(),
  ASK_SIZE: Joi.any().required(),
  DAILY_CHANGE: Joi.number().optional(),
  DAILY_CHANGE_PERC: Joi.number().optional(),
  LAST_PRICE: Joi.number().positive().optional(),
  VOLUME: Joi.number().positive().optional(),
  HIGH: Joi.number().positive().optional(),
  LOW: Joi.number().positive().optional()
}
const schemaBITFINEX =
      Joi.object().keys(

      ).required()

const monitor3 = (config, runtime) => {
  const pairs = []
  const symbols = []
  let subscriptions = {}

  const retry = () => {
    try { if (client3) client3.close(1000, 'schema') } catch (ex) {
      debug('monitor3', { event: 'end', message: ex.toString() })
    }

    client3 = undefined
    subscriptions = {}
    setTimeout(function () { monitor3(config, runtime) }, 15 * msecs.second)
  }

  if (client3) return

  config.altcoins.forEach((altcoin) => {
    const possibles = {
/* handled by monitor1
      BCH: [ 'BTC', 'ETH', 'USD' ],
      BTC: [ 'EUR', 'USD', 'XRP' ],
 */
      BTG: [ 'BTC', 'USD' ],
      DASH: [ 'BTC', 'USD' ]
/* handled by monitor1
      ETH: [ 'BTC', 'USD' ],
      LTC: [ 'BTC', 'USD' ]
 */
    }

    if (!possibles[altcoin]) return

    possibles[altcoin].forEach((coin) => {
      if (config.allcoins.indexOf(coin) === -1) return

      pairs.push(((altcoin !== 'DASH') ? altcoin : 'DSH') + coin)
      symbols.push(altcoin + '-' + coin)
    })
  })
  debug('monitor3', { symbols: symbols })

  client3 = (new Bitfinex()).ws(2)
  client3.on('open', () => {
    debug('monitor3', { event: 'connected' })

    pairs.forEach((pair) => { client3.subscribeTicker('t' + pair) })
  }).on('close', () => {
    debug('monitor3', { event: 'disconnected' })
    retry()
  }).on('error', (msg) => {
    debug('monitor3', underscore.extend({ event: 'error' }, msg))
    retry()
  }).on('subscribed', (msg) => {
    subscriptions[msg.chanId] = msg
  }).on('message', (data) => {
    const packet = Array.isArray(data) && (data.length === 2) && data
    const symbol = packet && subscriptions[packet[0]] && subscriptions[packet[0]].pair
    const params = packet && underscore.object(underscore.keys(paramsBITFINEX), packet[1])
    let validity
    let src = symbol && symbol.substr(0, 3)
    let dst = symbol && symbol.substr(3)

    if ((data.event) || (!symbol)) return

    validity = Joi.validate(params, schemaBITFINEX)
    if (validity.error) {
      retry()
      return runtime.captureException(validity.error, { extra: { data: data } })
    }
    if (!params.LAST_PRICE) return

    if (src === 'DSH') src = 'DASH'
    else if (dst === 'DSH') dst = 'DASH'

    if (!singleton.altrates[src]) singleton.altrates[src] = {}
    singleton.altrates[src][dst] = params.LAST_PRICE

    if (!singleton.altrates[dst]) singleton.altrates[dst] = {}
    singleton.altrates[dst][src] = 1.0 / params.LAST_PRICE

    Currency.prototype.altrates = singleton.altrates
  }).on('unsubscribed', (msg) => {
    debug('monitor3', underscore.extend({ event: 'unsubscribed' }, msg))
    retry()
  }).open()
}

const monitor4 = (config, runtime) => {
  let cacheTTL

  if (!config.oxr) return

  cacheTTL = parseInt(config.oxr.cacheTTL, 10)
  if (isNaN(cacheTTL) || (cacheTTL < 1)) cacheTTL = 7 * 24 * 1000 * 3600
  singleton.oxr = oxr.cache({
    store: {
      get: function () {
        return Promise.resolve(this.value)
      },
      put: function (value) {
        this.value = value
        return Promise.resolve(this.value)
      }
    },
    ttl: parseInt(cacheTTL, 10)
  }, oxr.factory({ appId: config.oxr.apiID }))
}

const maintenance = async (config, runtime) => {
  const now = underscore.now()
  let fxrates, rates, results, tickers

  if (config.helper) {
    rates = JSON.parse(JSON.stringify(singleton.rates))

    try {
      results = await retrieve(runtime, config.helper.url + '/v1/rates', {
        headers: {
          authorization: 'Bearer ' + config.helper.access_token,
          'content-type': 'application/json'
        },
        useProxyP: true
      }, Currency.prototype.schemas.rates)
    } catch (ex) {
      runtime.captureException(ex)
    }

    underscore.keys(results).forEach((key) => {
      if (typeof singleton[key] !== 'object') return

      underscore.extend(singleton[key], results[key])
      Currency.prototype[key] = singleton[key]
    })
    singleton.config.altcoins.forEach((currency) => {
      if (underscore.isEqual(rates[currency], singleton.rates[currency])) return

      debug(currency + ' fiat rates', JSON.stringify(underscore.pick(singleton.rates[currency], fiats)))
    })

    return
  }

  if (flatlineP) {
    debug('maintenance', { message: 'no trades reported' })
    runtime.captureException(new Error('maintenance reports flatline'))
    if (process.env.NODE_ENV !== 'production') process.exit(0)

    await dial911(config, runtime)
  }
  flatlineP = true

  if (singleton.oxr) {
    try { fxrates = await singleton.oxr.latest() } catch (ex) {
      runtime.captureException(ex)
    }
    if ((fxrates) && (fxrates.rates)) singleton.fxrates = fxrates
  }

  try { tickers = await inkblot(config, runtime) } catch (ex) {
    if (singleton.warnings <= now) {
      singleton.warnings = now + (15 * msecs.minute)
      runtime.captureException(ex)
    }
  }

  try { await rorschach(singleton.altrates, tickers, config, runtime) } catch (ex) {
    if (singleton.warnings <= now) {
      singleton.warnings = now + (15 * msecs.minute)
      runtime.captureException(ex)
    }
  }

  for (let altcoin of config.altcoins) {
    const f = altcoins[altcoin]

    if ((f) && (f.f)) await f.f(tickers, config, runtime)
  }
}

const retrieve = async (runtime, url, props, schema) => {
  let result, validity

  result = singleton.cache.get('url:' + url)
  if (result) return result

  result = await braveHapi.wreck.get(url, props || {})
  if (Buffer.isBuffer(result)) result = result.toString()
// courtesy of https://stackoverflow.com/questions/822452/strip-html-from-text-javascript#822464
  if (result.indexOf('<html>') !== -1) throw new Error(result.replace(/<(?:.|\n)*?>/gm, ''))

  result = JSON.parse(result)
  validity = schema ? Joi.validate(result, schema) : {}
  if (validity.error) {
    runtime.captureException(validity.error, { extra: { data: result } })
    throw new Error(validity.error)
  }

  singleton.cache.set('url:' + url, result)
  return result
}

const schemaCMC =
      Joi.object().keys({
        symbol: Joi.string().regex(/^[A-Z]{3,4}$/).required(),
        price_btc: Joi.number().positive().required(),
        price_usd: Joi.number().positive().required()
      }).unknown(true).required()

const dial911 = async (config, runtime) => {
  const fiat = 'USD'
  let entries

  try {
    entries = await retrieve(runtime, 'https://api.coinmarketcap.com/v1/ticker/?convert=' + fiat)
  } catch (ex) {
    return runtime.captureException('dial911 ticker error: ' + fiat + ': ' + ex.message)
  }
  entries.forEach((entry) => {
    const src = entry.symbol
    const validity = Joi.validate(entry, schemaCMC)

    if ((config.allcoins.indexOf(src) === -1) || (!altcoins[src]) || (altcoins[src].id !== entry.id) || (validity.error)) return

    console.log('processing ' + JSON.stringify(entry, null, 2))
    underscore.keys(entry).forEach((key) => {
      const dst = key.substr(6).toUpperCase()

      if ((src === dst) || (key.indexOf('price_') !== 0)) return

      if (!singleton.altrates[src]) singleton.altrates[src] = {}
      singleton.altrates[src][dst] = entry[key]

      if (!singleton.altrates[dst]) singleton.altrates[dst] = {}
      singleton.altrates[dst][src] = 1.0 / entry[key]
    })
  })
}

const inkblot = async (config, runtime) => {
  const unavailable = []
  let tickers = {}

  const ticker = async (fiat) => {
    let entries

    try {
      entries = await retrieve(runtime, 'https://api.coinmarketcap.com/v1/ticker/?convert=' + fiat)
    } catch (ex) {
      ex.message = fiat + ': ' + ex.message
      throw ex
    }
    entries.forEach((entry) => {
      const src = entry.symbol
      const validity = Joi.validate(entry, schemaCMC)

      if (config.allcoins.indexOf(src) === -1) return

      if (!altcoins[src]) return runtime.captureException('monitor ticker error: no entry for altcoins[' + src + ']')

      if (altcoins[src].id !== entry.id) return

      if (validity.error) return runtime.captureException('monitor ticker error: ' + validity.error, { extra: { data: entry } })

      underscore.keys(entry).forEach((key) => {
        const dst = key.substr(6).toUpperCase()

        if ((src === dst) || (key.indexOf('price_') !== 0)) return

        if (!tickers[src]) tickers[src] = {}
        tickers[src][dst] = entry[key]

        if (!tickers[dst]) tickers[dst] = {}
        tickers[dst][src] = 1.0 / entry[key]
      })
    })
  }

  for (let i = fiats.length - 1; i >= 0; i--) {
    let fiat = fiats[i]

    if (((fiat !== 'USD') || (fiats.length === 1)) && (!tickers[fiat])) await ticker(fiat)
  }
  fiats.forEach((fiat) => { if (!tickers[fiat]) unavailable.push(fiat) })
  if (unavailable.length > 0) throw new Error('fiats ' + unavailable.join(', ') + ' unavailable')

  return normalize(tickers, config, runtime)
}

const rorschach = async (rates, tickers, config, runtime) => {
  let informP, now

  const compare = (currency, fiat, rate1, rate2) => {
    const ratio = rate1 / rate2

    if ((ratio >= 0.9) && (ratio <= 1.1)) return

    debug('rorschach', { altcoin: currency, fiat: fiat, rate1: rate1, rate2: rate2 })
    throw new Error(currency + ' error: ' + fiat + ' ' + rate1 + ' vs. ' + rate2)
  }

  rates = normalize(rates, config, runtime)

  fiats.forEach((fiat) => {
    config.altcoins.forEach((altcoin) => {
      if (rates[altcoin][fiat]) compare(altcoin, fiat, rates[altcoin][fiat], tickers[altcoin][fiat])
    })
  })

  singleton.tickers = tickers

  now = underscore.now()
  informP = singleton.informs <= now
  config.altcoins.forEach((currency) => {
    const rate = singleton.rates[currency] || {}

    singleton.rates[currency] = underscore.extend(underscore.clone(rate), rates[currency] || {})
    if ((informP) && (!underscore.isEqual(singleton.rates[currency], rate))) {
      debug(currency + ' fiat rates', JSON.stringify(underscore.pick(singleton.rates[currency], fiats)))
    }
  })
  if (informP) singleton.informs = now + (1 * msecs.minute)

  singleton.rates = normalize(singleton.rates, config, runtime)
  Currency.prototype.rates = singleton.rates
}

const normalize = (rates, config, runtime) => {
  const tickers = singleton.tickers

  config.allcoins.forEach((currency) => { if (!rates[currency]) rates[currency] = {} })

  underscore.keys(rates).forEach((src) => {
    if (config.altcoins.indexOf(src) === -1) return

    underscore.keys(tickers).forEach((dst) => {
      if (src === dst) return

      underscore.keys(rates[src]).forEach((rate) => {
        if (rates[src][dst]) return

        if (rates[dst][src]) {
          rates[src][dst] = 1.0 / rates[dst][src]
          return
        }

        if ((!tickers[rate]) || (!tickers[rate][dst]) || (!rates[src]) || (!rates[src][rate])) return

        rates[src][dst] = tickers[rate][dst] * rates[src][rate]
        rates[dst][src] = 1.0 / rates[src][dst]
      })
    })
  })

  config.allcoins.forEach((src) => {
    config.allcoins.forEach((dst) => {
      if ((src === dst) || (rates[src][dst])) return

      underscore.keys(tickers).forEach((currency) => {
        if (rates[src][dst]) return

        if (rates[dst][src]) {
          rates[src][dst] = 1.0 / rates[dst][src]
          return
        }

        if ((!tickers[currency]) || (!tickers[currency][dst]) || (!rates[src]) || (!rates[src][currency])) return

        rates[src][dst] = tickers[currency][dst] * rates[src][currency]
        rates[dst][src] = 1.0 / rates[src][dst]
      })
    })
  })

  return underscore.omit(rates, fiats)
}

Currency.prototype.fiatP = function (currency) {
  const entry = currencyCodes.code(currency)

  return Array.isArray(entry && entry.countries)
}

// satoshis, wei, etc.
Currency.prototype.decimals = {
  BAT: 18,
  BCH: 8,
  BTC: 8,
  BTG: 8,
  DASH: 8,
  ETC: 18,
  ETH: 18,
  LTC: 8,
  NMC: 8,
  PPC: 6,
  XPM: 8,
  XRP: 6,
  ZEC: 8
}

// satoshis, wei, etc.
Currency.prototype.alt2scale = function (altcurrency) {
  const scale = Currency.prototype.decimals[altcurrency]

  if (scale) return ('1e' + scale.toString())
}

Currency.prototype.alt2fiat = function (altcurrency, probi, currency, floatP) {
  const entry = currencyCodes.code(currency)
  const rate = singleton.rates[altcurrency] && singleton.rates[altcurrency][currency]
  const scale = singleton.alt2scale(altcurrency)
  let amount

  if (!rate) return

  if (!(probi instanceof BigNumber)) probi = new BigNumber(probi.toString())
  amount = probi.times(new BigNumber(rate.toString()))
  if (floatP) return amount

  if (scale) amount = amount.dividedBy(scale)

  return amount.toFixed(entry ? entry.digits : 2)
}

Currency.prototype.fiat2alt = function (currency, amount, altcurrency) {
  const rate = singleton.rates[altcurrency] && singleton.rates[altcurrency][currency]
  const scale = singleton.alt2scale(altcurrency)
  let probi

  if ((!amount) || (!rate)) return

  if (!(amount instanceof BigNumber)) amount = new BigNumber(amount.toString())
  probi = amount.dividedBy(new BigNumber(rate.toString()))

  if (scale) probi = probi.times(scale)

  return probi.floor().toString()
}

module.exports = function (config, runtime) {
  if (!singleton) {
    singleton = new Currency(config, runtime)
    if (!config.currency.static) singleton.init()
  }

  return singleton
}
