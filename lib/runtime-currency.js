const crypto = require('crypto')

const Client = require('signalr-client-forked').client
const currencyCodes = require('currency-codes')
const SDebug = require('sdebug')
const debug = new SDebug('currency')
const Joi = require('joi')
const underscore = require('underscore')

const braveHapi = require('./extras-hapi')

const fiats = [ 'USD', 'EUR', 'GBP' ]

let client
let singleton

const Currency = function (config, runtime) {
  if (!(this instanceof Currency)) return new Currency(config, runtime)

  if (!config.currency) throw new Error('config.currency undefined')

  this.config = config.currency
  this.runtime = runtime

  this.rates = Currency.prototype.rates
  this.tickers = {}

  if (!this.config.altcoins) this.config.altcoins = [ 'BAT', 'ETH' ]
  this.config.altcoins.forEach((altcoin) => {
    const f = altcoins[altcoin]

    if ((f) && (f.p)) f.p(this.config, this.runtime)
  })
  this.config.allcoins = underscore.clone(this.config.altcoins)
  fiats.forEach((fiat) => { if (this.config.allcoins.indexOf(fiat) === -1) this.config.allcoins.push(fiat) })

  maintenance(this.config, this.runtime)
  setInterval(function () { maintenance(this.config, this.runtime) }.bind(this), 5 * 60 * 1000)

  monitor(this.config, this.runtime)
}
Currency.prototype.rates = {}

const schemaSR =
      Joi.array().min(1).items(Joi.object().keys({
        MarketName: Joi.string().regex(/^[0-9A-Z]{2,}-[0-9A-Z]{2,}$/).required(),
        Last: Joi.number().positive().required()
      }).unknown(true)).required()

const monitor = (config, runtime) => {
  const retry = () => {
    try { if (client) client.end() } catch (ex) { debug('signalR', { event: 'end', message: ex.toString() }) }

    client = undefined
    setTimeout(function () { monitor(config, runtime) }, 15 * 1000)
  }

  if (client) return

  client = new Client('http://socket.bittrex.com/signalR', [ 'coreHub' ])

  client.on('coreHub', 'updateSummaryState', async (data) => {
    const validity = Joi.validate(data.Deltas, schemaSR)
    let tickers
    let rates = {}

    if (validity.error) {
      retry()
      return runtime.notify(debug, { text: 'monitor signalR error: ' + validity.error })
    }

    data.Deltas.forEach((delta) => {
      const pair = delta.MarketName.split('-')
      const src = pair[0]
      const dst = pair[1]

      if ((src === dst) || (config.allcoins.indexOf(src) === -1) || (config.allcoins.indexOf(dst) === -1)) return

      if (!rates[src]) rates[src] = {}
      rates[src][dst] = 1.0 / delta.Last

      if (!rates[dst]) rates[dst] = {}
      rates[dst][src] = delta.Last
    })

    try { tickers = await inkblot(config, runtime) } catch (ex) {
      console.log(ex.stack)
      return runtime.notify(debug, { text: 'monitor inkblot error: ' + ex.toString() })
    }

    try { await rorschach(rates, tickers, config, runtime) } catch (ex) {
      console.log(ex.stack)
      return runtime.notify(debug, { text: 'monitor rorschach error: ' + ex.toString() })
    }
  })

  client.serviceHandlers.connected = client.serviceHandlers.reconnected = (connection) => {
    debug('signalR', { event: 'connected', connected: connection.connected })
    if (!connection.connected) retry()
  }
  client.serviceHandlers.connectFailed = (err) => {
    debug('signalR', { event: 'connectFailed', message: err.toString() })
    retry()
  }
  client.serviceHandlers.connectionLost = (err) => {
    debug('signalR', { event: 'connectionLost', message: err.toString() })
    retry()
  }
  client.serviceHandlers.onerror = (err) => {
    debug('signalR', { event: 'err', message: err.toString() })
    retry()
  }
  client.serviceHandlers.disconnected = () => {
    debug('signalR', { event: 'disconnected' })
    retry()
  }
}

const schemaBTC1 =
      Joi.object({}).pattern(/timestamp|[A-Z]{3}/,
                             Joi.alternatives().try(Joi.date(),
                                                    Joi.object().keys({ last: Joi.number().positive() }).unknown(true)))
      .required()

const altcoins = {
  BAT: {
    id: 'basic-attention-token'
  },

  BTC: {
    id: 'bitcoin',

    p: (config, runtime) => {
      if (!config.bitcoin_average) throw new Error('config.currency.bitcoin_average undefined')

      if (!config.bitcoin_average.publicKey) throw new Error('config.currency.bitcoin_average.publicKey undefined')

      if (!config.bitcoin_average.secretKey) throw new Error('config.currency.bitcoin_average.secretKey undefined')
    },

    f: async (tickers, config, runtime) => {
      const timestamp = Math.round(underscore.now() / 1000)
      const prefix = timestamp + '.' + config.bitcoin_average.publicKey
      const suffix = crypto.createHmac('sha256', config.bitcoin_average.secretKey).update(prefix).digest('hex')
      const signature = prefix + '.' + suffix
      const unavailable = []
      let rates, result

      try {
        result = await retrieve('https://apiv2.bitcoinaverage.com/indices/global/ticker/all?crypto=BTC',
                                { headers: { 'x-signature': signature } }, schemaBTC1)
      } catch (ex) {
        return runtime.notify(debug, { text: 'BTC.f retrieve error: ' + ex.toString() })
      }

      rates = {}
      underscore.keys(result).forEach(currency => {
        const rate = result[currency]
        const dst = currency.substr(3)

        if ((currency.indexOf('BTC') !== 0) || (typeof rate !== 'object') || (!rate.last) || (fiats.indexOf(dst) === -1)) return

        rates[dst] = rate.last
      })
      fiats.forEach((fiat) => { if (!rates[fiat]) unavailable.push(fiat) })
      if (unavailable.length > 0) {
        return runtime.notify(debug, { text: 'BTC.f fiat error: ' + unavailable.join(', ') + ' unavailable' })
      }

      try { await rorschach({ BTC: rates }, tickers, config, runtime) } catch (ex) {
        console.log(ex.stack)
        return runtime.notify(debug, { text: 'BTC.f rorschach error: ' + ex.toString() })
      }
    }
  },

  ETH: {
    id: 'ethereum'
  }
}

const maintenance = async (config, runtime) => {
  let tickers

  try { tickers = await inkblot(config, runtime) } catch (ex) {
    console.log(ex.stack)
    return runtime.notify(debug, { text: 'maintenance inkblot error: ' + ex.toString() })
  }

  config.altcoins.forEach((altcoin) => {
    const f = altcoins[altcoin]

    if ((f) && (f.f)) f.f(tickers, config, runtime)
  })
}

const retrieve = async (url, props, schema) => {
  let result, validity

  result = await braveHapi.wreck.get(url, props || {})
  if (Buffer.isBuffer(result)) result = result.toString()
// courtesy of https://stackoverflow.com/questions/822452/strip-html-from-text-javascript#822464
  if (result.indexOf('<html>') !== -1) throw new Error(result.replace(/<(?:.|\n)*?>/gm, ''))

  result = JSON.parse(result)
  validity = schema ? Joi.validate(result, schema) : {}
  if (validity.error) throw new Error(validity.error)

  return result
}

const schemaCMC =
      Joi.object().keys({
        symbol: Joi.string().regex(/^[A-Z]{3}$/).required(),
        price_btc: Joi.number().positive().required(),
        price_usd: Joi.number().positive().required()
      }).unknown(true).required()
const inkblot = async (config, runtime) => {
  const unavailable = []
  let tickers = {}

  const ticker = async (fiat) => {
    let entries = await retrieve('https://api.coinmarketcap.com/v1/ticker/?convert=' + fiat)

    entries.forEach((entry) => {
      const src = entry.symbol
      const validity = Joi.validate(entry, schemaCMC)

      if (config.allcoins.indexOf(src) === -1) return

      if (!altcoins[src]) return runtime.notify(debug, { text: 'monitor ticker error: no entry for altcoins[' + src + ']' })

      if (altcoins[src].id !== entry.id) return

      if (validity.error) return runtime.notify(debug, { text: 'monitor ticker error: ' + validity.error })

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
  const compare = (currency, fiat, rate1, rate2) => {
    const ratio = rate1 / rate2

    if ((ratio < 0.9) || (ratio > 1.1)) throw new Error(currency + ' error: ' + fiat + ' ' + rate1 + ' vs. ' + rate2)
  }

  rates = normalize(rates, config, runtime)

  fiats.forEach((fiat) => {
    config.altcoins.forEach((altcoin) => {
      if (rates[altcoin][fiat]) compare(altcoin, fiat, rates[altcoin][fiat], tickers[altcoin][fiat])
    })
  })

  singleton.tickers = tickers
  config.altcoins.forEach((currency) => {
    const rate = singleton.rates[currency] || {}

    singleton.rates[currency] = underscore.extend(underscore.clone(rate), rates[currency] || {})
    if (!underscore.isEqual(singleton.rates[currency], rate)) {
      debug(currency + ' fiat rates', JSON.stringify(underscore.pick(singleton.rates[currency], fiats)))
    }
  })
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

Currency.prototype.alt2fiat = function (altcurrency, probi, currency) {
  const entry = currencyCodes.code(currency)
  const rate = singleton.rates[altcurrency] && singleton.rates[altcurrency][currency]
  let amount

  if (!rate) return

  amount = probi * rate
  if (altcurrency === 'BTC') amount /= 1e8

  return amount.toFixed(entry ? entry.digits : 2)
}

Currency.prototype.fiat2alt = function (currency, amount, altcurrency) {
  const rate = singleton.rates[altcurrency] && singleton.rates[altcurrency][currency]
  let probis

  if ((!amount) || (!rate)) return

  probis = amount / rate
  if (altcurrency === 'BAT') probis *= 1e8

  return Math.floor(probis)
}

module.exports = function (config, runtime) {
  if (!singleton) singleton = new Currency(config, runtime)

  return singleton
}
