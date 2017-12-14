const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

/*
   GET /v1/address/{paymentId}
 */

v1.get =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const address = request.params.address
    const altcurrency = request.params.altcurrency
    const pair = {}
    const schema = braveJoi.string().altcurrencyAddress(altcurrency).required().description('the alturrency address')
    const validity = Joi.validate(address, schema)
    const wallets = runtime.database.get('wallets', debug)
    let wallet

    if (validity.error) return reply(boom.badData(validity.error))

    pair['addresses.' + altcurrency] = address
    wallet = await wallets.findOne(pair)
    if (!wallet) return reply(boom.notFound('invalid altcurrency/address: ' + altcurrency + '/' + address))

    reply(underscore.omit(wallet, [ '_id' ]))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Retrieves information about a wallet with an altcurrency address',
  tags: [ 'api' ],

  validate: {
    params: {
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      address: braveJoi.string().required().description('the altcurrency address')
    }
  },

  response: {
    schema: Joi.object().keys({}).unknown(true)
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/address/{altcurrency}/{address}').whitelist().config(v1.get)
]
