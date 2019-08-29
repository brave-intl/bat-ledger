const Joi = require('@hapi/joi')
const _ = require('underscore')
const braveJoi = require('bat-utils/lib/extras-joi')
const braveHapi = require('bat-utils/lib/extras-hapi')
const boom = require('boom')
const extrasUtils = require('bat-utils/lib/extras-utils')
const transactionsLib = require('../lib/transaction')
const grantsLib = require('../lib/grants')
const snapshotsLib = require('../lib/snapshots')

const grantTypeValidator = Joi.string().valid('ads')
const settlementTypeValidator = Joi.string().valid('contribution', 'referral')
const numeric = braveJoi.string().numeric()
const requiredDate = Joi.date().iso().required()
const dateRangeParams = Joi.object().keys({
  start: requiredDate.description('the date to start the query'),
  until: Joi.date().iso().optional().description('the date to query until')
})
const v1 = {}

/*
  GET /v1/stats/grants/{type}/{start}/{until?}
*/

v1.grantsStats = {
  handler: (runtime) => async (request, h) => {
    const { params } = request
    const { type } = params
    const client = await runtime.postgres.connect()
    const options = Object.assign({
      type
    }, extrasUtils.backfillDateRange(params))
    try {
      const stats = await grantsLib.stats(runtime, client, options)
      return sanitize(stats)
    } catch (e) {
      throw boom.boomify(e)
    } finally {
      client.release()
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
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
  GET /v1/stats/settlements/{type}/{start}/{until?}
*/

v1.settlementsStats = {
  handler: (runtime) => async (request, h) => {
    const { params, query } = request
    const { settlement_currency: settlementCurrency } = query
    const { type } = params
    const client = await runtime.postgres.connect()
    const options = Object.assign({
      settlementCurrency,
      type: `${type}_settlement`
    }, extrasUtils.backfillDateRange(params))
    try {
      let stats = {}
      if (settlementCurrency) {
        stats = await transactionsLib.settlementStatsByCurrency(runtime, client, options)
      } else {
        stats = await transactionsLib.allSettlementStats(runtime, client, options)
      }
      return sanitize(stats)
    } catch (e) {
      throw boom.boomify(e)
    } finally {
      client.release()
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
    mode: 'required'
  },
  description: 'Retrieves information about bat paid out in referrals',
  tags: [ 'api' ],
  validate: {
    query: Joi.object().keys({
      settlement_currency: braveJoi.string().anycurrencyCode().optional().description('the settlement currency to query for')
    }),
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

/*
  GET /v1/stats/settlements/{type}/{start}/{until?}
*/

v1.snapshotStats = {
  handler: snapshotStatsHandler,
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
    mode: 'required'
  },
  description: 'Retrieves information about bat paid out in referrals',
  tags: [ 'api' ],
  validate: {
    params: Joi.object().keys({
      date: requiredDate.description('date of the snapshot to retreive')
    })
  },
  response: {
    schema: Joi.array().items(Joi.object().keys({
      targetDate: requiredDate.description('the date that the snapshot is for'),
      createdAt: requiredDate.description('when the snapshot was taken'),
      top: Joi.object().pattern(/\w+/, Joi.array().items(Joi.object().keys({
        balance: numeric.required().description('the balance of this top publisher'),
        id: Joi.string().required().description('id of the top channel'),
        type: Joi.string().description('the type of top value this publisher is')
      }))),
      votes: Joi.array().items(Joi.object().keys({
        channel: numeric.required().description('a count of the channels in this snapshot cohort'),
        amount: numeric.required().description('a count of the amount transferred'),
        fees: numeric.required().description('a count of the fees transferred'),
        cohort: Joi.string().required().description('the cohort that the count of votes belong to')
      }).description('a cohort snapshot')),
      transactions: Joi.array().items(Joi.object().keys({
        channel: numeric.required().description('a count of the channels in this snapshot cohort'),
        amount: numeric.required().description('a count of the amount transferred'),
        type: Joi.string().required().description('the type of transaction being counted')
      }).description('a transaction type snapshot'))
    }).description('a single snapshot'))
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/stats/aggregate/{date}').whitelist().config(v1.snapshotStats),
  braveHapi.routes.async().path('/v1/stats/grants/{type}/{start}/{until?}').whitelist().config(v1.grantsStats),
  braveHapi.routes.async().path('/v1/stats/settlements/{type}/{start}/{until?}').whitelist().config(v1.settlementsStats)
]

function sanitize (data) {
  return _.mapObject(data, (value) => value || '0')
}

function snapshotStatsHandler (runtime) {
  return async (request, h) => {
    const { params } = request
    const client = await runtime.postgres.connect()
    const date = new Date(decodeURIComponent(params.date))
    try {
      const result = await snapshotsLib.getSnapshots(runtime, client, {
        start: date
      })
      return result.length ? result : boom.notFound('that date was not found')
    } catch (e) {
      throw boom.boomify(e)
    } finally {
      client.release()
    }
  }
}
