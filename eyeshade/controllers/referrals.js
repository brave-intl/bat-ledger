const Joi = require('joi')
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
const currencyValidator = braveJoi.string().altcurrencyCode().description('the currency unit being paid out')
const countryCodeValidator = braveJoi.string().countryCode().allow('OT').description('a country code in iso 3166 format').example('CA')

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

module.exports.routes = [
  braveHapi.routes.async().path('/v1/referrals/groups').whitelist().config(v1.getReferralGroups)
]
