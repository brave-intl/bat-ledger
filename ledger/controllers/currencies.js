const Joi = require('joi')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/currencies/rates
 */

v1.all = { handler: (runtime) => {
  return async (request, reply) => {
    reply({ altrates: runtime.currency.altrates, rates: runtime.currency.rates })
  }
},
  description: 'Report all currency rates',
  tags: [ 'api' ],

  validate: { query: {} },

  response: { schema: Joi.object().keys({}).unknown(true).description('currency rates') }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/currencies/rates').config(v1.all)
]
