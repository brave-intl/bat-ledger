const boom = require('boom')
const Joi = require('joi')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/provider/{module}/{provider}/status
 */

v1.status =
{ handler: (runtime) => {
  return async (request, reply) => {
//  const debug = braveHapi.debug(module, request)
    const module = request.params.module
    const provider = request.params.provider
    let providers

    if ((!runtime[module]) || (typeof runtime[module].providers !== 'function')) {
      return reply(boom.notFound('invalid runtime module: ' + module))
    }
    providers = runtime[module].providers()
    if (providers.indexOf(provider) === -1) return reply(boom.notFound('invalid ' + module + ' runtime provider: ' + provider))

    reply(await runtime[module].ping(provider))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Determines the status of a provider',
  tags: [ 'api' ],

  validate: {
    params: {
      module: Joi.string().token().required().description('the module identity'),
      provider: Joi.string().token().required().description('the provider identity')
    }
  },

  response: {
    schema: Joi.object().keys({
    }).unknown(true)
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/provider/{module}/{provider}/status').whitelist().config(v1.status)
]
