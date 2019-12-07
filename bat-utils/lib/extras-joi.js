const base58check = require('bs58check')
const batPublisher = require('bat-publisher')
const bitcoin = require('bitcoinjs-lib')
const countryCodes = require('country-list')()
const currencyCodes = require('currency-codes')
const Joi = require('@hapi/joi')
const ethereumAddress = require('ethereum-address')

module.exports = Joi.extend((joi) => {
  return {
    base: joi.string(),
    type: 'string',
    messages: {
      'string.badAltcurrencyAddress': 'invalid altcurrency address',
      'string.badAltcurrencyCode': 'invalid alternate currency code',
      'string.badAnycurrencyCode': 'invalid alternate/fiat currency code',
      'string.badBase58': 'bad Base58 encoding',
      'string.badCountryCode': 'invalid country code',
      'string.badCurrencyCode': 'invalid currency code',
      'string.badEthAddress': 'invalid Ethereum address',
      'string.badFormat': 'invalid format'
    },
    rules: {
      altcurrencyAddress: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          if (!ethereumAddress.isAddress(value)) {
            return helpers.error('string.badEthAddress', { v: value }, state, options)
          }
          return value
        }
      },
      altcurrencyCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const regexp = new RegExp(/^[0-9A-Z]{2,}$/)
          if (!regexp.test(value)) {
            return helpers.error('string.badAltcurrencyCode', { v: value }, state, options)
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
            return helpers.error('string.badAnycurrencyCode', { v: value }, state, options)
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
            return helpers.error('string.badBase58', { v: value }, state, options)
          }
          return value
        }
      },
      countryCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const entry = countryCodes.getName(value)
          if (!entry) {
            return helpers.error('string.badCountryCode', { v: value }, state, options)
          }
          return value
        }
      },
      currencyCode: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const entry = currencyCodes.code(value)
          if (!entry) {
            return helpers.error('string.badCurrencyCode', { v: value }, state, options)
          }
          return value
        }
      },
      numeric: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const isNumeric = new RegExp(/^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i)
          if (!isNumeric.test(value)) {
            return helpers.error('string.badFormat', { v: value }, state, options)
          }
          return value
        }
      },
      owner: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          const props = batPublisher.getPublisherProps(value)
          if (!props || !props.publisherType) {
            return helpers.error('string.badFormat', { v: value }, state, options)
          }
          return value
        }
      },
      publisher: {
        validate (value, helpers, args, options) {
          const { state } = helpers
          if (!batPublisher.isPublisher(value)) {
            return helpers.error('string.badFormat', { v: value }, state, options)
          }
          return value
        }
      },
      Xpub: {
        // courtesy of the good folks at BitGo!
        validate (value, helpers, args, options) {
          const { state } = helpers
          if (value.substr(0, 4) !== 'xpub') {
            return helpers.error('string.badFormat', { v: value }, state, options)
          }
          try {
            bitcoin.HDNode.fromBase58(value)
          } catch (err) {
            return helpers.error('string.badBase58', { v: value }, state, options)
          }
          return value
        }
      }
    }
  }
})
