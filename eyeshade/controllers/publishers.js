const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v2 = {}

let altcurrency

/*
   POST /v2/publishers/settlement
 */

v2.settlement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      const fields = [ 'probi', 'amount', 'fee', 'fees', 'commission' ]
      let entry, state

      for (entry of payload) {
        if (entry.altcurrency !== altcurrency) return reply(boom.badData('altcurrency should be ' + altcurrency))
      }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: {}
      }
      for (entry of payload) {
        entry.commission = new BigNumber(entry.commission).plus(new BigNumber(entry.fee)).toString()
        fields.forEach((field) => { state.$set[field] = bson.Decimal128.fromString(entry[field].toString()) })
        underscore.extend(state.$set,
                          underscore.pick(entry, [ 'address', 'altcurrency', 'currency', 'hash', 'type', 'owner' ]))

        await settlements.update({ settlementId: entry.transactionId, publisher: entry.publisher }, state, { upsert: true })
      }

      await runtime.queue.send(debug, 'settlement-report', { settlementId: entry.transactionId, shouldUpdateBalances: true })

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Posts a settlement for one or more publishers',
  tags: [ 'api' ],

  validate: {
    payload: Joi.array().min(1).items(Joi.object().keys({
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      address: Joi.string().guid().required().description('settlement address'),
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      probi: braveJoi.string().numeric().required().description('the settlement in probi'),
      fees: braveJoi.string().numeric().default('0.00').description('processing fees'),
      currency: braveJoi.string().anycurrencyCode().default('USD').description('the deposit currency'),
      amount: braveJoi.string().numeric().required().description('the amount in the deposit currency'),
      commission: braveJoi.string().numeric().default('0.00').description('settlement commission'),
      fee: braveJoi.string().numeric().default('0.00').description('fee in addition to settlement commission'),
      transactionId: Joi.string().guid().required().description('the transactionId'),
      type: Joi.string().valid('contribution', 'referral').default('contribution').description('settlement input'),
      hash: Joi.string().guid().required().description('settlement-identifier')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v2/publishers/settlement').config(v2.settlement)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('publishers', debug),
      name: 'publishers',
      property: 'publisher',
      empty: {
        publisher: '',    // domain OR 'oauth#' + provider + ':' + (profile.id || profile._id)
        authority: '',

     // v1 only
     // authorized: false,
     // address: '',
     // legalFormURL: '',

        verified: false,
        visible: false,

     // v2 and later
        owner: '',

        providerName: '',
        providerSuffix: '',
        providerValue: '',
        authorizerEmail: '',
        authorizerName: '',

        altcurrency: '',

        info: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { publisher: 1 } ],
      others: [ { authority: 1 },
                { owner: 1 },
                { providerName: 1 }, { providerSuffix: 1 }, { providerValue: 1 },
                { authorizerEmail: 1 }, { authorizerName: 1 },
                { altcurrency: 1 },
                { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('settlements', debug),
      name: 'settlements',
      property: 'settlementId_1_publisher',
      empty: {
        settlementId: '',
        publisher: '',
        hash: '',
        address: '',

     // v1 only
     // satoshis: 1

     // v2 and later
        owner: '',
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,
        fees: bson.Decimal128.POSITIVE_ZERO,          // processing fees
        currency: '',
        amount: bson.Decimal128.POSITIVE_ZERO,
        commission: bson.Decimal128.POSITIVE_ZERO,    // conversion fee (i.e., for settlement)
        fee: bson.Decimal128.POSITIVE_ZERO,           // network fee (i.e., for settlement)
        type: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { settlementId: 1, publisher: 1 }, { hash: 1, publisher: 1 } ],
      others: [ { address: 1 },
                { owner: 1 }, { altcurrency: 1 }, { probi: 1 }, { fees: 1 }, { currency: 1 }, { amount: 1 }, { commission: 1 },
                { fee: 1 }, { type: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('publishersV2', debug),
      name: 'publishersV2',
      property: 'publisher',
      empty: { publisher: '', facet: '', exclude: false, tags: [], timestamp: bson.Timestamp.ZERO },
      unique: [ { publisher: 1 } ],
      others: [ { facet: 1 }, { exclude: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('publishers-bulk-create')
  await runtime.queue.create('report-publishers-statements')
}
