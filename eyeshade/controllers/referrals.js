import Joi from 'joi'
import underscore from 'underscore'

import { referralGroups } from '../lib/queries.js'
import countries from '../lib/countries.js'
import * as braveHapi from 'bat-utils/lib/extras-hapi.js'
import { braveJoi } from 'bat-utils/lib/extras-joi.js'
import * as extrasUtils from 'bat-utils/lib/extras-utils.js'
const _ = underscore

const v1 = {}

const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'

const amountValidator = braveJoi.string().numeric()
const groupNameValidator = Joi.string().optional().description('the name given to the group')
const currencyValidator = braveJoi.string().altcurrencyCode().description('the currency unit being paid out')
const countryCodeValidator = braveJoi.string().countryCode().allow('OT').description('a country code in iso 3166 format').example('CA')
const publisherValidator = braveJoi.string().publisher().allow(null, '').optional().description('the publisher identity. e.g. youtube#VALUE, twitter#VALUE, reddit#value, etc., or null.  owner aka publishers#VALUE should not go here')
const groupIdValidator = Joi.string().guid().description('the region from which this referral came')
const referralCodeValidator = Joi.string().required().description('the referral code tied to the referral')

const referralGroupCountriesValidator = Joi.object().keys({
  id: Joi.string().guid().required().description('the group id to report back for correct value categorization'),
  activeAt: Joi.date().iso().optional().description('the download cut off time to honor the amount'),
  name: groupNameValidator.optional().description('name of the group'),
  codes: Joi.array().items(countryCodeValidator).optional().description('country codes that belong to the group'),
  currency: currencyValidator.optional().description('the currency that the probi is calculated from'),
  amount: amountValidator.optional().description('the amount to pay out per referral in the given currency')
})
const referralGroupsCountriesValidator = Joi.array().items(referralGroupCountriesValidator)

const groupedReferralValidator = Joi.object().keys({
  publisher: publisherValidator,
  groupId: groupIdValidator.required().description('group id'),
  amount: amountValidator.description('the amount to be paid out in BAT'),
  referralCode: referralCodeValidator.allow(''),
  payoutRate: amountValidator.description('the rate of BAT per USD')
})

const dateRangeParams = Joi.object().keys({
  start: Joi.date().iso().required().description('the date to start the query'),
  until: Joi.date().iso().optional().description('the date to query until')
})

const fieldValidator = Joi.string().description('whether the field should be included or not')

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

    const statement = referralGroups()
    let { rows } = await runtime.postgres.query(statement, [activeAt || new Date()], true)

    if (resolve && fields.includes('codes')) {
      rows = countries.resolve(rows)
    }

    return rows.map((row) => _.pick(row, allFields))
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'referrals', 'publishers'],
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
  handler: (runtime) => async (request, h) => {
    const { database, currency } = runtime
    const { params, query } = request
    const { owner } = params
    const { start: qStart, until: qUntil } = query
    const {
      start,
      until
    } = extrasUtils.backfillDateRange({
      start: qStart || new Date((new Date()).toISOString().split('-').slice(0, 2).join('-')),
      until: qUntil
    })
    const debug = braveHapi.debug(module, request)
    const referrals = database.get('referrals', debug)
    const refs = await referrals.find({
      owner,
      finalized: {
        $gte: start,
        $lt: until
      }
    }, {
      _id: 0,
      publisher: 1,
      groupId: 1,
      probi: 1,
      payoutRate: 1,
      referralCode: 1
    })
    const scale = currency.alt2scale('BAT')
    return refs.map(({
      publisher,
      groupId,
      referralCode,
      payoutRate,
      probi
    }) => {
      const bat = (new extrasUtils.BigNumber(probi)).dividedBy(scale)
      return {
        publisher,
        referralCode: referralCode || '',
        groupId: _.isUndefined(groupId) ? originalRateId : groupId,
        payoutRate: payoutRate || bat.dividedBy(5).toString(),
        amount: bat.toString()
      }
    })
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'referrals', 'publishers'],
    mode: 'required'
  },

  description: 'Get the referral details for a publisher',
  tags: ['api', 'referrals'],

  validate: {
    headers: Joi.object({
      authorization: Joi.string().required()
    }).unknown(),
    query: dateRangeParams
  },

  response: {
    schema: Joi.array().items(groupedReferralValidator).description('the list of referrals attributed to a given owner')
  }
}

export const routes = [
  braveHapi.routes.async().path('/v1/referrals/groups').config(v1.getReferralGroups),
  braveHapi.routes.async().path('/v1/referrals/statement/{owner}').config(v1.getReferralsStatement)
]
