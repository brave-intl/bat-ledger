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
const dateRangeParams = Joi.object().keys({
  start: Joi.date().iso().required().description('the date to start the query'),
  until: Joi.date().iso().optional().description('the date to query until')
})
const v1 = {}

/*
  GET /v1/stats/grants/{type}
*/

v1.grantsStats = {
  handler: (runtime) => async (request, reply) => {
    const { params } = request
    const { type } = params
    const client = await runtime.postgres.connect()
    const options = Object.assign({
      type
    }, backfillDateRange(params))
    try {
      const stats = await grantsLib.stats(runtime, client, options)
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
    params: dateRangeParams.keys({
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
    const options = Object.assign({
      type: `${type}_settlement`
    }, backfillDateRange(params))
    try {
      const stats = await transactionsLib.stats(runtime, client, options)
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
    params: dateRangeParams.keys({
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
  braveHapi.routes.async().path('/v1/stats/grants/{type}/{start}/{until?}').whitelist().config(v1.grantsStats),
  braveHapi.routes.async().path('/v1/stats/settlements/{type}/{start}/{until?}').whitelist().config(v1.settlementsStats)
]

function sanitize (data) {
  return _.mapObject(data, (value) => value || '0')
}

function backfillDateRange ({
  start,
  until
}) {
  if (until) {
    return {
      start: new Date(start),
      until: new Date(until)
    }
  }
  let end = start
  const DAY = 1000 * 60 * 60 * 24
  const month = end.getMonth()
  while (month === end.getMonth()) {
    end = new Date(+end + DAY)
  }
  return {
    start,
    until: end
  }
}
