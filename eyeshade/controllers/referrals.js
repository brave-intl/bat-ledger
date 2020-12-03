const boom = require('boom')
const Joi = require('@hapi/joi')
const underscore = require('underscore')
const _ = underscore

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const queries = require('../lib/queries')
const countries = require('../lib/countries')

const v1 = {}

const amountValidator = braveJoi.string().numeric()
const groupNameValidator = Joi.string().optional().description('the name given to the group')
const publisherValidator = braveJoi.string().publisher().allow(null, '').optional().description('the publisher identity. e.g. youtube#VALUE, twitter#VALUE, reddit#value, etc., or null.  owner aka publishers#VALUE should not go here')
const currencyValidator = braveJoi.string().altcurrencyCode().description('the currency unit being paid out')
const groupIdValidator = Joi.string().guid().description('the region from which this referral came')
const countryCodeValidator = braveJoi.string().countryCode().allow('OT').description('a country code in iso 3166 format').example('CA')
const referralCodeValidator = Joi.string().required().description('the referral code tied to the referral')

const referral = Joi.object().keys({
  ownerId: braveJoi.string().owner().required().description('the owner'),
  channelId: publisherValidator,
  downloadId: Joi.string().guid().required().description('the download identity'),
  platform: Joi.string().token().required().description('the download platform'),
  finalized: Joi.date().iso().required().description('timestamp in ISO 8601 format').example('2018-03-22T23:26:01.234Z')
})
const referralGroupCountriesValidator = Joi.object().keys({
  id: Joi.string().guid().required().description('the group id to report back for correct value categorization'),
  activeAt: Joi.date().iso().optional().description('the download cut off time to honor the amount'),
  name: groupNameValidator.optional().description('name of the group'),
  codes: Joi.array().items(countryCodeValidator).optional().description('country codes that belong to the group'),
  currency: currencyValidator.optional().description('the currency that the probi is calculated from'),
  amount: amountValidator.optional().description('the amount to pay out per referral in the given currency')
})
const referralGroupsCountriesValidator = Joi.array().items(referralGroupCountriesValidator)

const fieldValidator = Joi.string().description('whether the field should be included or not')

/*
   GET /v1/referrals/{transactionID}
 */

v1.findReferrals = {
  handler: (runtime) => {
    return async (request, h) => {
      const transactionId = request.params.transactionId
      const debug = braveHapi.debug(module, request)
      const transactions = runtime.database.get('referrals', debug)

      const entries = await transactions.find({ transactionId: transactionId })
      if (entries.length === 0) {
        throw boom.notFound('no such transaction-identifier: ' + transactionId)
      }

      return entries.map((entry) => {
        return underscore.extend({ channelId: entry.publisher },
          underscore.pick(entry, ['downloadId', 'platform', 'finalized']))
      })
    }
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'referrals'],
    mode: 'required'
  },

  description: 'Returns referral transactions for a publisher',
  tags: ['api', 'referrals'],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: Joi.object().keys({
      transactionId: Joi.string().guid().required().description('the transaction identity')
    }).unknown(true)
  },

  response:
    { schema: referral }
}

/*
  GET /v1/referrals/groups
  [ used by promo, and publishers ]
  defines the referral country code groups
*/

v1.getReferralGroups = {
  handler: (runtime) => async (request, h) => {
    let { fields, resolve, activeAt } = request.query
    fields = _.isString(fields) ? fields.split(',').map((str) => str.trim()) : (fields || [])
    const allFields = ['id'].concat(fields)

    const statement = queries.referralGroups()
    let { rows } = await runtime.postgres.query(statement, [activeAt || new Date()], true)

    if (resolve && fields.includes('codes')) {
      rows = countries.resolve(rows)
    }

    return rows.map((row) => _.pick(row, allFields))
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'referrals'],
    mode: 'required'
  },

  description: 'Records referral transactions for a publisher',
  tags: ['api', 'referrals'],

  validate: {
    headers: Joi.object({
      authorization: Joi.string().required()
    }).unknown(),
    query: Joi.object().keys({
      resolve: Joi.boolean().optional().description('optionally resolve groups so that only the active categorization shows'),
      activeAt: Joi.date().iso().optional().description('a parameter to get active group state at a given point in time'),
      fields: Joi.alternatives().try(
        fieldValidator,
        Joi.array().items(fieldValidator)
      )
    }).unknown()
  },

  response: {
    schema: referralGroupsCountriesValidator
  }
}

/*
  GET /v1/referrals/statement/{owner}
*/


v1.getReferralsStatement = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

/*
   PUT /v1/referrals/{transactionID}
       [ used by promo ]
 */

v1.createReferrals = {
  handler: (runtime) => () => {
    throw boom.resourceGone()
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/referrals/groups').whitelist().config(v1.getReferralGroups),
  braveHapi.routes.async().path('/v1/referrals/statement/{owner}').whitelist().config(v1.getReferralsStatement),
  braveHapi.routes.async().path('/v1/referrals/{transactionId}').whitelist().config(v1.findReferrals),
  braveHapi.routes.async().put().path('/v1/referrals/{transactionId}').whitelist().config(v1.createReferrals)
]

module.exports.initialize = async (debug, runtime) => {
}
