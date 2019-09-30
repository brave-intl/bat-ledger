const boom = require('boom')
const bson = require('bson')
const BigNumber = require('bignumber.js')
const Joi = require('@hapi/joi')
const underscore = require('underscore')
const _ = underscore

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const extrasUtils = utils.extras.utils

const queries = require('../lib/queries')

const v1 = {}

const getActiveGroups = `
SELECT
  id,
  amount,
  currency,
  active_at as "activeAt"
FROM geo_referral_groups
WHERE
  active_at <= current_timestamp;`

const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'

const amountValidator = braveJoi.string().numeric()
const groupNameValidator = Joi.string().optional().description('the name given to the group')
const publisherValidator = braveJoi.string().publisher().required().description('the publisher identity')
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
const manyReferrals = Joi.array().min(1).items(referral).required().description('list of finalized referrals')
const groupStampedReferral = referral.keys({
  downloadTimestamp: Joi.date().iso().optional().description('the timestamp when the referral was downloaded to apply correct payout to it'),
  groupId: groupIdValidator.allow('').optional(),
  referralCode: referralCodeValidator
})
const manyGroupStampedReferrals = Joi.array().min(1).items(groupStampedReferral).required().description('list of finalized referrals to be shown to publishers')

const anyReferralVersion = Joi.alternatives().try(
  manyGroupStampedReferrals,
  manyReferrals
)

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
  referralCode: referralCodeValidator,
  payoutRate: amountValidator.description('the rate of BAT per USD')
})

const dateRangeParams = Joi.object().keys({
  start: Joi.date().iso().required().description('the date to start the query'),
  until: Joi.date().iso().optional().description('the date to query until')
})

const fieldValidator = Joi.string().description('whether the field should be included or not')

/*
   GET /v1/referrals/{transactionID}
 */

v1.findReferrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const transactionId = request.params.transactionId
      const debug = braveHapi.debug(module, request)
      const transactions = runtime.database.get('referrals', debug)
      let entries, results

      entries = await transactions.find({ transactionId: transactionId })
      if (entries.length === 0) return reply(boom.notFound('no such transaction-identifier: ' + transactionId))

      results = []
      entries.forEach((entry) => {
        results.push(underscore.extend({ channelId: entry.publisher },
          underscore.pick(entry, [ 'downloadId', 'platform', 'finalized' ])))
      })
      reply(results)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Returns referral transactions for a publisher',
  tags: [ 'api', 'referrals' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: {
      transactionId: Joi.string().guid().required().description('the transaction identity')
    }
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
  handler: (runtime) => async (request, reply) => {
    let { fields } = request.query
    const statement = queries.referralGroups()
    fields = _.isString(fields) ? fields.split(',').map((str) => str.trim()) : (fields || [])
    const allFields = ['id'].concat(fields)

    const { rows } = await runtime.postgres.query(statement)

    reply(rows.map((row) => _.pick(row, allFields)))
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Records referral transactions for a publisher',
  tags: [ 'api', 'referrals' ],

  validate: {
    headers: Joi.object({
      authorization: Joi.string().required()
    }).unknown(),
    query: Joi.object().keys({
      active: Joi.boolean().optional().description('optionally filter active or inactive groups'),
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
  handler: (runtime) => async (request, reply) => {
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
    const mappedRefs = refs.map(({
      publisher,
      groupId,
      referralCode,
      payoutRate,
      probi
    }) => {
      const bat = (new BigNumber(probi)).dividedBy(scale)
      return {
        publisher,
        referralCode: referralCode || '',
        groupId: _.isUndefined(groupId) ? originalRateId : groupId,
        payoutRate: payoutRate || bat.dividedBy(5).toString(),
        amount: bat.toString()
      }
    })
    reply(mappedRefs)
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Get the referral details for a publisher',
  tags: [ 'api', 'referrals' ],

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

/*
   PUT /v1/referrals/{transactionID}
       [ used by promo ]
 */

v1.createReferrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const { payload, params } = request
      const { transactionId } = params
      const debug = braveHapi.debug(module, request)
      const { database, postgres, currency, queue, prometheus, config } = runtime
      const { altcurrency = 'BAT' } = config
      const referrals = database.get('referrals', debug)
      const factor = currency.alt2scale(altcurrency)
      const referralsToInsert = []
      // get rates once at beginning (uses cache too)
      const {
        rows: referralGroups
      } = await postgres.query(getActiveGroups)
      referralGroups.sort((a) => a.activeAt)

      for (const referral of payload) {
        const {
          platform,
          finalized,
          downloadId,
          downloadTimestamp,
          ownerId: owner,
          referralCode = '',
          channelId: publisher,
          groupId: passedGroupId
        } = referral

        const groupId = passedGroupId || originalRateId
        const config = _.findWhere(referralGroups, {
          // no group has falsey id
          id: groupId
        })
        if (!config) {
          return reply(boom.notFound('referral group not found'))
        }
        const {
          amount: groupAmount,
          currency: groupCurrency
        } = config

        const probiString = await currency.fiat2alt(groupCurrency, groupAmount, altcurrency)
        let probi = new BigNumber(probiString)
        const payoutRate = probi.dividedBy(factor).dividedBy(groupAmount).toString()
        probi = bson.Decimal128.fromString(probi.toString())

        referralsToInsert.push({
          // previous upsert was redundant
          updateOne: {
            upsert: true,
            filter: {
              downloadId
            },
            update: {
              $currentDate: {
                timestamp: { $type: 'timestamp' }
              },
              $setOnInsert: {
                downloadId,
                downloadTimestamp,
                groupId,
                referralCode,
                altcurrency,
                finalized: new Date(finalized),
                owner,
                publisher,
                transactionId,
                payoutRate,
                probi,
                platform,
                exclude: false
              }
            }
          }
        })
      }
      const bulkResult = await referrals.bulkWrite(referralsToInsert)
      if (!bulkResult.ok) {
        // insert failed
        runtime.captureException(new Error('failed to insert'), {
          extra: {
            bulkResult,
            transactionId
          }
        })
      }

      await queue.send(debug, 'referral-report', {
        transactionId
      })
      prometheus.getMetric('referral_received_counter').inc(bulkResult.upsertedCount)

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Records referral transactions for a publisher',
  tags: [ 'api', 'referrals' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: {
      transactionId: Joi.string().guid().required().description('the transaction identity')
    },
    payload: anyReferralVersion
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/referrals/groups').whitelist().config(v1.getReferralGroups),
  braveHapi.routes.async().path('/v1/referrals/statement/{owner}').whitelist().config(v1.getReferralsStatement),
  braveHapi.routes.async().path('/v1/referrals/{transactionId}').whitelist().config(v1.findReferrals),
  braveHapi.routes.async().put().path('/v1/referrals/{transactionId}').whitelist().config(v1.createReferrals)
]

module.exports.initialize = async (debug, runtime) => {
  await runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('referrals', debug),
      name: 'referrals',
      property: 'downloadId',
      empty: {
        downloadId: '',

        transactionId: '',
        publisher: '',
        owner: '',
        platform: '',
        finalized: bson.Timestamp.ZERO,

        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,

        // added by administrator
        exclude: false,
        hash: '',
        groupId: '',
        payoutRate: '',
        referralCode: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { downloadId: 1 } ],
      others: [ { transactionId: 1 }, { publisher: 1 }, { owner: 1 }, { finalized: 1 },
        { altcurrency: 1 }, { probi: 1 }, { exclude: 1 }, { hash: 1 }, { timestamp: 1 },
        { altcurrency: 1, probi: 1 },
        { altcurrency: 1, exclude: 1, probi: 1 },
        { owner: 1, altcurrency: 1, exclude: 1, probi: 1 },
        { publisher: 1, altcurrency: 1, exclude: 1, probi: 1 } ]
    }
  ])
}
