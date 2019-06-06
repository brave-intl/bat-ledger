const Joi = require('@hapi/joi')
const _ = require('underscore')
const braveJoi = require('bat-utils/lib/extras-joi')
const braveHapi = require('bat-utils/lib/extras-hapi')
const boom = require('boom')
const transactionsLib = require('../lib/transaction')
const grantsLib = require('../lib/grants')

const grantTypeValidator = Joi.string().allow(['ads'])
const settlementTypeValidator = Joi.string().allow(['contribution', 'referrals'])
const numeric = braveJoi.string().numeric()
const v1 = {}

/*
  GET /v1/stats/grants/{type}
*/

v1.grantsStats = {
  handler: (runtime) => async (request, reply) => {
    const { params } = request
    const { type } = params
    const client = await runtime.postgres.connect()
    try {
      const stats = await grantsLib.stats(runtime, client, {
        type
      })
      reply(sanitize(stats))
    } catch (e) {
      reply(boom.boomify(e))
    } finally {
      await client.release()
    }
  },
  auth: {
    strategy: 'simple',
    mode: 'required'
  },
  description: 'Retrieves information about grants',
  tags: [ 'api' ],
  validate: {
    params: Joi.object().keys({
      type: grantTypeValidator.description('grant type to query for')
    })
  },
  response: {
    schema: Joi.object().keys({
      amount: numeric.description('the total amount of bat contributed in votes'),
      count: numeric.description('the number of votes of a given type')
    })
  }
}

/*
  GET /v1/stats/settlements/{type}
*/

v1.settlementsStats = {
  handler: (runtime) => async (request, reply) => {
    const { params } = request
    const { type } = params
    const client = await runtime.postgres.connect()
    try {
      const stats = await transactionsLib.stats(runtime, client, {
        type: `${type}_settlement`
      })
      reply(sanitize(stats))
    } catch (e) {
      reply(boom.boomify(e))
    } finally {
      await client.release()
    }
  },
  auth: {
    strategy: 'simple',
    mode: 'required'
  },
  description: 'Retrieves information about bat paid out in referrals',
  tags: [ 'api' ],
  validate: {
    params: Joi.object().keys({
      type: settlementTypeValidator.description('settlement type to query for')
    })
  },
  response: {
    schema: Joi.object().keys({
      amount: numeric.description('the total amount of bat paid out in settlements')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/stats/grants/{type}').whitelist().config(v1.grantsStats),
  braveHapi.routes.async().path('/v1/stats/settlements/{type}').whitelist().config(v1.settlementsStats)
]

function sanitize (data) {
  return _.mapObject(data, (value) => value || '0')
}
