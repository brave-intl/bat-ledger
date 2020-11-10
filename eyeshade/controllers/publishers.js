const boom = require('boom')
const bson = require('bson')
const Joi = require('@hapi/joi')
const underscore = require('underscore')
const settlement = require('../lib/settlements')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const { BigNumber } = utils.extras.utils

const v2 = {}

let altcurrency

/*
   POST /v2/publishers/settlement
 */

const settlementGroupsValidator = Joi.object().pattern(
  /\w{2,25}/, Joi.array().items(
    Joi.string().guid()
  )
)

async function addSettlementsToKafkaQueue (runtime, request) {
  const { payload } = request

  await this.producer()
  const msgs = payload.map((payload) => {
    const {
      transactionId,
      hash,
      address,
      publisher,
      altcurrency,
      currency,
      owner,
      probi,
      fee,
      amount,
      commission,
      fees,
      type
    } = payload
    return {
      settlementId: transactionId,
      address,
      publisher,
      altcurrency,
      currency,
      owner,
      fee,
      commission,
      amount,
      probi,
      fees,
      hash,
      type
    }
  })
  await runtime.kafka.sendMany(
    settlement,
    msgs
  )
  return {}
}

v2.settlement = {
  handler: (runtime) => {
    return async (request, h) => {
      if (runtime.config.forward.settlements) {
        return addSettlementsToKafkaQueue(runtime, request)
      }
      const {
        payload
      } = request
      const { fromString } = bson.Decimal128
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      const numberFields = ['probi', 'amount', 'fee', 'fees', 'commission']
      const mappedFields = ['address', 'altcurrency', 'currency', 'hash', 'type', 'owner', 'documentId']

      if (payload.find((entry) => entry.altcurrency !== altcurrency)) {
        throw boom.badData('altcurrency should be ' + altcurrency)
      }

      const $currentDate = { timestamp: { $type: 'timestamp' } }
      const executedTime = new Date()
      const settlementGroups = {}
      for (let i = 0; i < payload.length; i += 1) {
        const entry = payload[i]
        const {
          commission,
          fee,
          type,
          publisher,
          executedAt,
          transactionId: settlementId
        } = entry

        const bigFee = new BigNumber(fee)
        const bigCom = new BigNumber(commission)
        const bigComPlusFee = bigCom.plus(bigFee)

        const picked = underscore.pick(entry, mappedFields)
        picked.commission = fromString(bigComPlusFee.toString())
        picked.executedAt = new Date(executedAt || executedTime)
        const $set = numberFields.reduce((memo, field) => {
          memo[field] = fromString(entry[field].toString())
          return memo
        }, picked)

        const state = {
          $set,
          $currentDate
        }

        await settlements.update({
          settlementId,
          publisher
        }, state, { upsert: true })

        let entries = settlementGroups[type]
        if (!entries) {
          entries = []
          settlementGroups[type] = entries
        }
        if (!entries.includes(settlementId)) {
          entries.push(settlementId)
        }
      }

      return settlementGroups
    }
  },

  auth: {
    strategies: ['simple-scoped-token', 'session'],
    scope: ['ledger', 'publishers'],
    mode: 'required'
  },
  payload: {
    maxBytes: 1024 * 1024 * 20 // 20 MB
  },
  description: 'Posts a settlement for one or more publishers',
  tags: ['api'],

  validate: {
    payload: Joi.array().min(1).items(Joi.object().keys({
      executedAt: braveJoi.date().iso().optional().description('the timestamp the settlement was executed'),
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().when('type', { is: Joi.string().valid('manual'), then: Joi.optional().allow(''), otherwise: Joi.required() }).description('the publisher identity'),
      address: Joi.string().required().description('settlement address'),
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      probi: braveJoi.string().numeric().required().description('the settlement in probi'),
      fees: braveJoi.string().numeric().default('0.00').description('processing fees'),
      currency: braveJoi.string().anycurrencyCode().default('USD').description('the deposit currency'),
      amount: braveJoi.string().numeric().required().description('the amount in the deposit currency'),
      commission: braveJoi.string().numeric().default('0.00').description('settlement commission'),
      fee: braveJoi.string().numeric().default('0.00').description('fee in addition to settlement commission'),
      transactionId: Joi.string().guid().required().description('the transactionId'),
      type: Joi.string().valid('contribution', 'referral', 'manual').default('contribution').description('settlement input'),
      hash: Joi.string().required().description('settlement-identifier')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response: {
    schema: settlementGroupsValidator
  }
}

v2.submitSettlement = {
  handler: (runtime) => async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const { payload: settlementGroups } = request
    const settlementGroupKeys = underscore.keys(settlementGroups)
    for (let i = 0; i < settlementGroupKeys.length; i += 1) {
      const type = settlementGroupKeys[i]
      const settlementIds = underscore.uniq(settlementGroups[type])
      for (let j = 0; j < settlementIds.length; j += 1) {
        const settlementId = settlementIds[j]
        await runtime.queue.send(debug, 'settlement-report', {
          type,
          settlementId
        })
      }
    }

    return {}
  },

  auth: {
    strategies: ['simple-scoped-token', 'session'],
    scope: ['ledger', 'publishers'],
    mode: 'required'
  },
  payload: {
    maxBytes: 1024 * 1024 * 20 // 20 MB
  },
  description: 'Posts a list of settlement ids and types to trigger the worker',
  tags: ['api'],

  validate: {
    payload: settlementGroupsValidator
  },

  response: {
    schema: Joi.object().length(0)
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v2/publishers/settlement/submit').config(v2.submitSettlement),
  braveHapi.routes.async().post().path('/v2/publishers/settlement').config(v2.settlement)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}
