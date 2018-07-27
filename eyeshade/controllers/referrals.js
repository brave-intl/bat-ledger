const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

const schema = Joi.array().min(1).items(Joi.object().keys({
  channelId: braveJoi.string().publisher().required().description('the publisher identity'),
  downloadId: Joi.string().guid().required().description('the download identity'),
  platform: Joi.string().token().required().description('the download platform'),
  finalized: Joi.date().iso().required().description('timestamp in ISO 8601 format').example('2018-03-22T23:26:01.234Z')
}).unknown(true)).required().description('list of finalized referrals')

let altcurrency

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
    { schema: schema }
}

/*
   PUT /v1/referrals/{transactionID}
       [ used by referrals ]
 */

v1.createReferrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const { postgres, database } = runtime
      const transactionId = request.params.transactionId
      const payload = request.payload
      const debug = braveHapi.debug(module, request)
      const publishers = database.get('publishers', debug)
      const referrals = database.get('referrals', debug)
      let entries, matches, probi, query

      entries = await referrals.find({ transactionId: transactionId })
      if (entries.length > 0) return reply(boom.badData('existing transaction-identifier: ' + transactionId))

      probi = runtime.currency.fiat2alt(runtime.config.referrals.currency, runtime.config.referrals.amount, altcurrency)
      probi = bson.Decimal128.fromString(probi.toString())
      query = { $or: [] }
      for (let referral of payload) {
        const entry = await publishers.findOne({ publisher: referral.channelId })
        if (!entry) return reply(boom.badData('no such channelId: ' + referral.channelId))

        underscore.extend(referral, { owner: entry.owner, altcurrency: altcurrency, probi: probi })
        query.$or.push({ downloadId: referral.downloadId })
      }
      entries = await referrals.find(query)
      if (entries.length > 0) {
        matches = []
        entries.forEach((referral) => { matches.push(referral.downloadId) })
        return reply(boom.badData('existing download-identifier' + ((entries.length > 1) ? 's' : '') + ': ' +
                                  matches.join(', ')))
      }

      const createdAt = new Date()

      for (let referral of payload) {
        let state
        let $set

        $set = underscore.extend({
          transactionId: transactionId,
          publisher: referral.channelId,
          finalized: new Date(referral.finalized),
          exclude: false
        }, underscore.pick(referral, [ 'owner', 'platform', 'altcurrency', 'probi' ]))

        state = {
          $currentDate: { timestamp: { $type: 'timestamp' } },
          $set
        }
        await referrals.update({ downloadId: referral.downloadId }, state, { upsert: true })

        // DOUBLE ENTRY
        let transactions = postgres.transactionsFrom('referral', {
          probi: $set.probi,
          transactionId,
          publisher: referral.channelId,
          owner: referral.owner,
          createdAt
        })
        await postgres.insertTransactions(transactions)
      }

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
    payload: schema
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/referrals/{transactionId}').whitelist().config(v1.findReferrals),
  braveHapi.routes.async().put().path('/v1/referrals/{transactionId}').whitelist().config(v1.createReferrals)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.database.checkIndices(debug, [
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
