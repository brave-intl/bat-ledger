const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

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

module.exports.routes = [
  braveHapi.routes.async().path('/v1/address/{address}/validate').whitelist().config(v1.validate)
]

module.exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('wallet-report')
}

/* END: EXPERIMENTAL/DEPRECATED */
