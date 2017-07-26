const base58check = require('bs58check')
const batPublisher = require('bat-publisher')
const bitcoin = require('bitcoinjs-lib')
const countryCodes = require('country-list')()
const currencyCodes = require('currency-codes')
const Joi = require('joi')

module.exports = Joi.extend({
  base: Joi.string(),
  name: 'string',
  language: {
    badBase58: 'bad Base58 encoding',
    badFormat: 'invalid format',
    badCountryCode: 'invalid country code',
    badCurrencyCode: 'invalid currency code'
  },
  rules: [
    { name: 'base58',

      validate (params, value, state, options) {
        try { base58check.decode(value) } catch (err) {
          return this.createError('string.badBase58', { v: value }, state, options)
        }

        return value
      }
    },

    { name: 'countryCode',

      validate (params, value, state, options) {
        const entry = countryCodes.getName(value)

        if (!entry) return this.createError('string.badCountryCode', { v: value }, state, options)

        return value
      }
    },

    { name: 'currencyCode',

      validate (params, value, state, options) {
        const entry = currencyCodes.code(value)

        if (!entry) return this.createError('string.badCurrencyCode', { v: value }, state, options)

        return value
      }
    },

    { name: 'publisher',

      validate (params, value, state, options) {
        value = value.toLowerCase()
        if (!batPublisher.isPublisher(value)) return this.createError('string.badFormat', { v: value }, state, options)

        return value
      }
    },

    { name: 'Xpub',

      // courtesy of the good folks at BitGo!
      validate (params, value, state, options) {
        if (value.substr(0, 4) !== 'xpub') return this.createError('string.badFormat', { v: value }, state, options)

        try { bitcoin.HDNode.fromBase58(value) } catch (err) {
          return this.createError('string.badBase58', { v: value }, state, options)
        }

        return value
      }
    }
  ]
})
