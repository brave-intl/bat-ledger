const Joi = require('joi')
const underscore = require('underscore')

const braveHapi = require('./extras-hapi')
const npminfo = require('../npminfo')

const v1 = {}

/*
   GET /v1/ping
 */

v1.ping = {
  handler: (runtime) => {
    return async (request, reply) => {
      reply(underscore.omit(npminfo, [ 'dependencies' ]))
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'devops' ],
    mode: 'required'
  },

  description: 'Returns information about the server',
  tags: [ 'api' ],

  validate:
    { query: {} },

  response:
    { schema: Joi.object().keys().unknown(true).description('static properties of the server') }
}

module.exports.routes = [ braveHapi.routes.async().path('/v1/ping').config(v1.ping) ]
