const crypto = require('crypto')

const Client = require('signalr-client-forked').client
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

  this.fiats = {}
  this.rates = Currency.prototype.rates

  if (!this.config.currencies) this.config.currencies = [ 'BAT', 'ETH' ]
  this.config.currencies.forEach((currency) => {
    const f = fetch[currency]

    if ((f) && (f.p)) f.p(this.config, this.runtime)
  })
  fiats.forEach((fiat) => { if (this.config.currencies.indexOf(fiat) === -1) this.config.currencies.push(fiat) })

  maintenance(this.config, this.runtime)
  setInterval(function () { maintenance(this.config, this.runtime) }.bind(this), 5 * 60 * 1000)

  monitor(this.config, this.runtime)
}
Currency.prototype.rates = {}

const schemaSR =
      Joi.array().min(1).items(Joi.object().keys({
        MarketName: Joi.string().regex(/[0-9A-Z][0-9A-Z]-[0-9A-Z][0-9A-Z]/).required(),
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

  client.on('coreHub', 'updateSummaryState', (data) => {
    const validity = Joi.validate(data.Deltas, schemaSR)
    let rates = {}

    if (validity.error) {
      retry()
      return runtime.notify(debug, { text: 'monitor error(1): ' + validity.error })
    }

    data.Deltas.forEach((delta) => {
      const pair = delta.MarketName.split('-')
      const src = pair[0]
      const dst = pair[1]

      if ((src === dst) || (config.currencies.indexOf(src) === -1) || (config.currencies.indexOf(dst) === -1)) return

      if (!rates[src]) rates[src] = {}
      rates[src][dst] = 1.0 / delta.Last
      if (!rates[dst]) rates[dst] = {}
      rates[dst][src] = delta.Last

      if (!singleton.rates[src]) singleton.rates[src] = {}
      singleton.rates[src][dst] = 1.0 / delta.Last

      if (!singleton.rates[dst]) singleton.rates[dst] = {}
      singleton.rates[dst][src] = delta.Last
    })

    underscore.keys(rates).forEach((currency) => {
      if (config.currencies.indexOf(currency) === -1) return

      if (!singleton.fiats[currency]) singleton.fiats[currency] = {}
      fiats.forEach((fiat) => {
        underscore.keys(rates[currency]).forEach((rate) => {
          if ((singleton.fiats[currency][fiat]) || (!singleton.fiats[rate]) || (!singleton.fiats[rate][fiat])) return

          rates[currency][fiat] = singleton.fiats[rate][fiat] * rates[currency][rate]
          singleton.rates[currency][fiat] = rates[currency][fiat]
        })
      })
    })
    Currency.prototype.rates = singleton.rates

    underscore.keys(singleton.rates).forEach((currency) => {
      if (config.currencies.indexOf(currency) !== -1) {
        debug(currency + ' exchange rates', underscore.pick(singleton.rates[currency], config.currencies))
      }
    })
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

const schemaBAT1 =
      Joi.array().min(1).max(1).items(Joi.object().keys({
        symbol: Joi.string().regex(/BAT/).required(),
        price_btc: Joi.number().positive().required(),
        price_usd: Joi.number().positive().required()
      }).unknown(true)).required()
const schemaBTC1 =
      Joi.object({}).pattern(/timestamp|[A-Z][A-Z][A-Z]/,
                             Joi.alternatives().try(Joi.date(),
                                                    Joi.object().keys({ last: Joi.number().positive() }).unknown(true)))
      .required()
const schemaBTC2 =
      Joi.object().keys({
        bpi: Joi.object().pattern(/[A-Z][A-Z][A-Z]/,
                                  Joi.object().keys({
                                    code: Joi.string().regex(/[A-Z][A-Z][A-Z]/).required(),
                                    rate_float: Joi.number().positive().required()
                                  }).unknown(true)).required()
      }).unknown(true)

const compare = (currency, fiat, rate1, rate2) => {
  const ratio = rate1 / rate2

  if ((ratio < 0.9) || (ratio > 1.1)) throw new Error(currency + ' error: ' + fiat + ' ' + rate1 + ' vs. ' + rate2)
}

const retrieve = async (url, props, schema) => {
  let result, validity

  result = await braveHapi.wreck.get(url, props)
  if (Buffer.isBuffer(result)) result = result.toString()
// courtesy of https://stackoverflow.com/questions/822452/strip-html-from-text-javascript#822464
  if (result.indexOf('<html>') !== -1) throw new Error(result.replace(/<(?:.|\n)*?>/gm, ''))

  result = JSON.parse(result)
  validity = Joi.validate(result, schema)
  if (validity.error) throw new Error(validity.error)

  return result
}

const fetch = {
  BAT: {
    f: async (config, runtime) => {
      let rates, result

      try {
        result = await retrieve('https://api.coinmarketcap.com/v1/ticker/basic-attention-token/', {}, schemaBAT1)
      } catch (ex) {
        return runtime.notify(debug, { text: 'fetchBAT error(1): ' + ex.toString() })
      }

      rates = {}
      underscore.keys(result[0]).forEach((key) => {
        if (key.indexOf('price_') !== 0) return

        rates[key.substr(6).toUpperCase()] = result[0][key]
      })

      console.log(JSON.stringify(rates, null, 2))
    }
  },

  BTC: {
    p: (config, runtime) => {
      if (!config.bitcoin_average) throw new Error('config.currency.bitcoin_average undefined')

      if (!config.bitcoin_average.publicKey) throw new Error('config.currency.bitcoin_average.publicKey undefined')

      if (!config.bitcoin_average.secretKey) throw new Error('config.currency.bitcoin_average.secretKey undefined')
    },

    f: async (config, runtime) => {
      const timestamp = Math.round(underscore.now() / 1000)
      const prefix = timestamp + '.' + config.bitcoin_average.publicKey
      const suffix = crypto.createHmac('sha256', config.bitcoin_average.secretKey).update(prefix).digest('hex')
      const signature = prefix + '.' + suffix
      let errP, rates, result1, result2

      try {
        result1 = await retrieve('https://apiv2.bitcoinaverage.com/indices/global/ticker/all?crypto=BTC',
                              { headers: { 'x-signature': signature } }, schemaBTC1)
      } catch (ex) {
        return runtime.notify(debug, { text: 'fetchBTC error(1): ' + ex.toString() })
      }

      try {
        result2 = await retrieve('https://api.coindesk.com/v1/bpi/currentprice.json', {}, schemaBTC2)
      } catch (ex) {
        return runtime.notify(debug, { text: 'fetchBTC error(2): ' + ex.toString() })
      }

      rates = {}
      underscore.keys(result1).forEach(currency => {
        const rate = result1[currency]

        if ((currency.indexOf('BTC') !== 0) || (typeof rate !== 'object') || (!rate.last)) return

        rates[currency.substr(3)] = rate.last
      })
      fiats.forEach((fiat) => { if (!rates[fiat]) errP = true })
      if (errP) {
        return runtime.notify(debug, { text: 'fetchBTC error(3): currencies available ' + underscore.keys(rates) })
      }

      fiats.forEach((fiat) => { if (!result2.bpi[fiat]) errP = true })
      if (errP) {
        return runtime.notify(debug, { text: 'fetchBTC error(4): currencies available ' +
                                       underscore.keys(result2.bpi) })
      }

      try {
        fiats.forEach((fiat) => { compare('BTC', fiat, rates[fiat], result2.bpi[fiat].rate_float) })
      } catch (ex) {
        return runtime.notify(debug, { text: ex.toString() })
      }

      singleton.fiats.BTC = rates
      underscore.extend(singleton.rates.BTC, underscore.pick(rates, fiats))
      Currency.prototype.rates = singleton.rates

      debug('BTC fiat rates', underscore.pick(rates, fiats))
    }
  }
}

const maintenance = async (config, runtime) => {
  config.currencies.forEach((currency) => {
    const f = fetch[currency]

    if (f) f.f(config, runtime)
  })
}

module.exports = function (config, runtime) {
  if (!singleton) singleton = new Currency(config, runtime)

  return singleton
}
