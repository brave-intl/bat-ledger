const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')
const BigNumber = require('bignumber.js')

const owners = require('../lib/owners')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v3 = {}
let altcurrency
/*
   GET /v1/owners/{owner}/wallet
       [ used by publishers ]
 */

v1.getWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const debug = braveHapi.debug(module, request)
      let entry, provider, result

      entry = await owners.readByOwner(runtime, owner)
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      const rates = await runtime.currency.rates(altcurrency)
      result = {
        rates
      }

      provider = entry && entry.provider
      try {
        if (provider && entry.parameters) result.wallet = await runtime.wallet.status(entry)
        if (result.wallet) {
          result.wallet = underscore.pick(result.wallet, [ 'provider', 'authorized', 'defaultCurrency', 'availableCurrencies', 'possibleCurrencies', 'address', 'status', 'isMember', 'id' ])
          if (entry.parameters.scope) {
            result.wallet.scope = entry.parameters.scope
          }

          const fxrates = await runtime.currency.all()
          const bigUSD = new BigNumber(rates.USD)
          underscore.union([result.wallet.defaultCurrency], result.wallet.availableCurrencies).forEach((currency) => {
            if ((rates[currency]) || (!rates.USD) || (!fxrates[currency])) return

            rates[currency] = bigUSD.times(fxrates[currency]).toString()
          })
        }
      } catch (ex) {
        debug('status', { reason: ex.toString(), stack: ex.stack, result, entry })
        runtime.captureException(ex, { req: request, extra: { owner: owner } })
      }
      if ((provider) && (!result.wallet)) {
        result.status = { provider: entry.provider, action: entry.parameters ? 're-authorize' : 'authorize' }
      }

      reply(result)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets wallet information for a publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { owner: braveJoi.string().owner().required().description('the owner identity') },
    query: { currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency') }
  },

  response: {
    schema: Joi.object().keys({
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      wallet: Joi.object().keys({
        id: Joi.string().required().description('the provider identifier'),
        provider: Joi.string().required().description('wallet provider'),
        authorized: Joi.boolean().optional().description('publisher is authorized by provider'),
        defaultCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the default currency to pay a publisher in'),
        availableCurrencies: Joi.array().items(braveJoi.string().anycurrencyCode()).description('currencies the publisher has cards for'),
        possibleCurrencies: Joi.array().items(braveJoi.string().anycurrencyCode()).description('currencies the publisher could have cards for'),
        scope: Joi.string().optional().description('scope of authorization with wallet provider'),
        address: Joi.string().guid().optional().description('address (id) for default currency card'),
        status: Joi.string().optional().description('wallet provider user status'),
        isMember: Joi.boolean().optional().description('wallet provider user is member')
      }).unknown(true).optional().description('publisher wallet information'),
      status: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        action: Joi.any().allow([ 'authorize', 're-authorize' ]).required().description('requested action')
      }).unknown(true).optional().description('publisher wallet status')
    })
  }
}

/*
  POST /v3/owners/{owner}/wallet/card
  {
    currency    : 'BAT'
  , label       : '' // description of the card
  }
 */
v3.createCard = {
  handler: (runtime) => async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const {
      payload,
      params
    } = request
    const {
      wallet
    } = runtime
    const {
      currency,
      label
    } = payload
    const {
      owner
    } = params

    const ownerObject = await owners.readByOwner(runtime, owner)
    if (!ownerObject) {
      return reply(boom.notFound('no such entry: ' + owner))
    }

    if (!owners.isVerified(ownerObject)) {
      return reply(boom.badData('owner not verified'))
    }
    debug('create card begin', {
      currency,
      label,
      owner
    })
    const created = await wallet.createCard(ownerObject, {
      currency,
      label
    })
    debug('card data create successful', currency)
    reply({
      currency: created.currency
    })
  },
  description: 'Create a card for uphold',
  tags: [ 'api' ],
  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: {
      owner: Joi.string().required().description('owner identifier')
    },
    payload: {
      label: Joi.string().optional().description('description of the card'),
      currency: Joi.string().default('BAT').optional().description('currency of the card to create')
    }
  },
  response: {
    schema: Joi.object().unknown(true)
  }
}

/*
   PUT /v1/owners/{owner}/wallet
       [ used by publishers ]
 */

v1.putWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const payload = request.payload

      await owners.create(runtime, owner, payload)

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Sets wallet information for a verified publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    payload: {
      provider: Joi.string().required().description('wallet provider'),
      parameters: Joi.object().required().description('wallet parameters'),
      defaultCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the default currency to pay a publisher in'),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   PATCH /v1/owners/{owner}/wallet
       [ used by publishers ]
 */

v1.patchWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const payload = request.payload

      const entry = await owners.readByOwner(runtime, owner)
      if (!entry) {
        return reply(boom.notFound('no such entry: ' + owner))
      }
      await owners.updateByOwner(runtime, entry.owner, entry, payload)
      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Updates wallet information for a verified publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    payload: {
      provider: Joi.string().optional().description('wallet provider'),
      parameters: Joi.object().optional().description('wallet parameters'),
      defaultCurrency: braveJoi.string().anycurrencyCode().optional().description('the default currency to pay a publisher in'),
      show_verification_status: Joi.boolean().optional().description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v3/owners/{owner}/wallet/card').config(v3.createCard),
  braveHapi.routes.async().path('/v1/owners/{owner}/wallet').whitelist().config(v1.getWallet),
  braveHapi.routes.async().put().path('/v1/owners/{owner}/wallet').whitelist().config(v1.putWallet),
  braveHapi.routes.async().patch().path('/v1/owners/{owner}/wallet').whitelist().config(v1.patchWallet)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}
