import Joi from 'joi'
import _ from 'underscore'
import { braveJoi } from 'bat-utils/lib/extras-joi.js'
import * as braveHapi from 'bat-utils/lib/extras-hapi.js'
import boom from '@hapi/boom'
import * as extrasUtils from 'bat-utils/lib/extras-utils.js'
import transactionsLib from '../lib/transaction.js'
import grantsLib from '../lib/grants.js'

const grantTypeValidator = Joi.string().valid('ads')
const settlementTypeValidator = Joi.string().valid('contribution', 'referral')
const numeric = braveJoi.string().numeric()
const dateRangeParams = Joi.object().keys({
  start: Joi.date().iso().required().description('the date to start the query'),
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
    const options = Object.assign({
      type
    }, extrasUtils.backfillDateRange(params))
    try {
      const stats = await grantsLib.stats(runtime, options)
      return sanitize(stats)
    } catch (e) {
      throw boom.boomify(e)
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
    mode: 'required'
  },
  description: 'Retrieves information about grants',
  tags: ['api'],
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
    const options = Object.assign({
      settlementCurrency,
      type: `${type}_settlement`
    }, extrasUtils.backfillDateRange(params))
    try {
      let stats = {}
      if (settlementCurrency) {
        stats = await transactionsLib.settlementStatsByCurrency(runtime, options)
      } else {
        stats = await transactionsLib.allSettlementStats(runtime, options)
      }
      return sanitize(stats)
    } catch (e) {
      throw boom.boomify(e)
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
    mode: 'required'
  },
  description: 'Retrieves information about bat paid out in referrals',
  tags: ['api'],
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

export const routes = [
  braveHapi.routes.async().path('/v1/stats/grants/{type}/{start}/{until?}').config(v1.grantsStats),
  braveHapi.routes.async().path('/v1/stats/settlements/{type}/{start}/{until?}').config(v1.settlementsStats)
]

function sanitize (data) {
  return _.mapObject(data, (value) => value || '0')
}
