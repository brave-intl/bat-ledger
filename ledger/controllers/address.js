const BigNumber = require('bignumber.js')
const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('../../bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}

/*
   GET /v1/address/{address}/validate
 */

v1.validate =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const address = request.params.address
    const wallets = runtime.database.get('wallets', debug)
    let balances, paymentId, state, wallet

    wallet = await wallets.findOne({ address: address })
    if (!wallet) return reply(boom.notFound('invalid address: ' + address))

    paymentId = wallet.paymentId
    balances = wallet.balances
    if (!balances) {
      balances = await runtime.wallet.balances(wallet)

      state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: balances } }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })

      await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: paymentId }, state.$set))
    }

    reply({
      paymentId: paymentId,
      satoshis: balances.confirmed > balances.unconfirmed ? balances.confirmed : balances.unconfirmed
    })
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Determines the validity of a BTC address',
  tags: [ 'api' ],

  validate: {
    params: { address: braveJoi.string().base58().required().description('BTC address') }
  },

  response: {
    schema: Joi.object().keys({
      paymentId: Joi.string().guid().required().description('identity of the wallet'),
      satoshis: Joi.number().integer().min(0).optional().description('the wallet balance in satoshis')
    })
  }
}

/*
   GET /v2/address/{altcurrency}/{address}/balance
 */

v2.balance =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const address = request.params.address
    const altcurrency = request.params.altcurrency
    const pair = {}
    const wallets = runtime.database.get('wallets', debug)
    let balances, paymentId, state, wallet

    pair['addresses.' + altcurrency] = address
    wallet = await wallets.findOne(pair)
    if (!wallet) return reply(boom.notFound('invalid altcurrency/address: ' + altcurrency + '/' + address))

    balances = await runtime.wallet.balances(wallet)
    if (!underscore.isEqual(balances, wallet.balances)) {
      state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: balances } }
      await wallets.update({ paymentId: wallet.paymentId }, state, { upsert: true })

      await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: paymentId }, state.$set))
    }

    reply({
      probi: balances.confirmed.toString(),
      balance: new BigNumber(balances.confirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4),
      unconfirmed: new BigNumber(balances.unconfirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4),
      rates: runtime.currency.rates[altcurrency]
    })
  }
},

  description: 'Temporary until balance servers are operational',
  tags: [ 'api' ],

  validate: {
    params: {
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the wallet currency'),
      address: braveJoi.string().altcurrencyAddress('BAT').required().description('the wallet address')
    }
  },

  response: {
    schema: Joi.object().keys({
      balance: Joi.number().min(0).optional().description('the (confirmed) wallet balance'),
      unconfirmed: Joi.number().min(0).optional().description('the unconfirmed wallet balance'),
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      probi: braveJoi.string().numeric().optional().description('the wallet balance in probi')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/address/{address}/validate').whitelist().config(v1.validate),
  braveHapi.routes.async().path('/v2/address/{altcurrency}/{address}/balance').config(v2.balance)
]

/* END: EXPERIMENTAL/DEPRECATED */
