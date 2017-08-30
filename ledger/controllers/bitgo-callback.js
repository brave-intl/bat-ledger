const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

/*
    POST /callbacks/bitgo/sink (from the BitGo server)
 */

/*
    { hash     : '...'
    , type     : 'transaction'
    , walletId : '...'
    }
 */

v1.sink =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const payload = request.payload || {}
    const address = payload.walletId
    const wallets = runtime.database.get('wallets', debug)
    const webhooks = runtime.database.get('webhooks', debug)
    let wallet, state

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { provider: 'bitgo', payload: payload } }
    await webhooks.update({ webhookId: uuid.v4().toLowerCase() }, state, { upsert: true })

    reply({})

    wallet = await wallets.findOne({ address: address })
    if (!wallet) return debug('no such bitgo wallet', payload)

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: await runtime.wallet.balances(wallet) } }
    await wallets.update({ paymentId: wallet.paymentId }, state, { upsert: true })

    await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: wallet.paymentId }, state.$set))
  }
},

  description: 'Webhooks',
  tags: [ 'api' ],

  validate: {
    payload: Joi.object().keys({
      walletId: braveJoi.string().base58().required().description('BTC address')
    }).unknown(true)
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [ braveHapi.routes.async().post().path('/callbacks/bitgo/sink').config(v1.sink) ]

module.exports.initialize = async (debug, runtime) => {
  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('webhooks', debug),
      name: 'webhooks',
      property: 'webhookId',
      empty: { webhookId: '', provider: '', payload: '', timestamp: bson.Timestamp.ZERO },
      unique: [ { webhookId: 1 } ],
      others: [ { provider: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('wallet-report')
}
