const base58check = require('bs58check')
const batPublisher = require('./extras-publisher')
const bitcoin = require('bitcoinjs-lib')
const countryCodes = require('country-list')()
const currencyCodes = require('currency-codes')
const Joi = require('joi')
const ethereumAddress = require('ethereum-address')

module.exports = Joi.extend((joi) => {
  return {
    base: joi.string(),
    type: 'string',
    messages: {
      'string.badAltcurrencyAddress': '{{#label}} invalid altcurrency address {{#value}}',
      'string.badAltcurrencyCode': '{{#label}} invalid alternate currency code {{#value}}',
      'string.badAnycurrencyCode': '{{#label}} invalid alternate/fiat currency code {{#value}}',
      'string.badBase58': '{{#label}} bad Base58 encoding {{#value}}',
      'string.badCountryCode': '{{#label}} invalid country code {{#value}}',
      'string.badCurrencyCode': '{{#label}} invalid currency code {{#value}}',
      'string.badEthAddress': '{{#label}} invalid Ethereum address {{#value}}',
      'string.badFormat': '{{#label}} invalid format {{#value}}'
    },
    rules: {
      altcurrencyAddress: {
        /*
          usage of this method requires being inside of an object where the altcurrency code is the key to the value
        */
        validate (value, helpers, args, options) {
          const { state } = helpers
          const parent = state.ancestors[0]
          const skipKeys = {
            CARD_ID: true,
            BAT: true
          }
          const key = Object.keys(parent).find((key) => {
            if (skipKeys[key]) return
            return parent[key] === value
          })
          if (key === 'BTC' || key === 'LTC') {
            try {
              base58check.decode(value)
            } catch (err) {
              return helpers.error('string.badBase58', { value }, state, options)
            }
          } else {
            if (!ethereumAddress.isAddress(value)) {
              return helpers.error('string.badEthAddress', { value }, state, options)
            }
          }
          return value
        }
      },
      altcurrencyCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const regexp = new RegExp(/^[0-9A-Z]{2,}$/)
          if (!regexp.test(value)) {
            return helpers.error('string.badAltcurrencyCode', { value }, state, options)
          }
          return value
        }
      },
      anycurrencyCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const entry = currencyCodes.code(value)
          const regexp = new RegExp(/^[0-9A-Z]{2,}$/)
          if (!entry && !regexp.test(value)) {
            return helpers.error('string.badAnycurrencyCode', { value }, state, options)
          }
          return value
        }
      },
      base58: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          try {
            base58check.decode(value)
          } catch (err) {
            return helpers.error('string.badBase58', { value }, state, options)
          }
          return value
        }
      },
      countryCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const entry = countryCodes.getName(value)
          if (!entry) {
            return helpers.error('string.badCountryCode', { value }, state, options)
          }
          return value
        }
      },
      currencyCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const entry = currencyCodes.code(value)
          if (!entry) {
            return helpers.error('string.badCurrencyCode', { value }, state, options)
          }
          return value
        }
      },
      numeric: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const isNumeric = new RegExp(/^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i)
          if (!isNumeric.test(value)) {
            return helpers.error('string.badFormat', { value }, state, options)
          }
          return value
        }
      },
      owner: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const props = batPublisher.getPublisherProps(value)
          if (!props || !props.publisherType) {
            return helpers.error('string.badFormat', { value }, state, options)
          }
          return value
        }
      },
      publisher: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          if (!batPublisher.isPublisher(value)) {
            return helpers.error('string.badFormat', { value }, state, options)
          }
          return value
        }
      },
      Xpub: {
        // courtesy of the good folks at BitGo!
        validate (value, helpers, args, options) {
          const { state } = helpers
          if (value.substr(0, 4) !== 'xpub') {
            return helpers.error('string.badFormat', { value }, state, options)
          }
          try {
            bitcoin.HDNode.fromBase58(value)
          } catch (err) {
            return helpers.error('string.badBase58', { value }, state, options)
          }
          return value
        }
      }
    }
  }
})
