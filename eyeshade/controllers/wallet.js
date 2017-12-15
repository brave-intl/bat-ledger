const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/wallet/{paymentId}
 */

v1.get =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const wallets = runtime.database.get('wallets', debug)
    let wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    reply(underscore.omit(wallet, [ '_id' ]))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Retrieves information about a paymentID',
  tags: [ 'api' ],

  validate: {
    params: {
      paymentId: Joi.string().guid().required().description('identity of the wallet')
    }
  },

  response: {
    schema: Joi.object().keys({}).unknown(true)
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/wallet/{paymentId}').whitelist().config(v1.get)
]
