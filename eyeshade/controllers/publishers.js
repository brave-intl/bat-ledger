const Joi = require('@hapi/joi')
const boom = require('boom')
const settlement = require('../lib/settlements')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v2 = {}

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

  await runtime.kafka.producer()
  const msgs = payload.map((payload) => {
    const {
      transactionId,
      hash,
      documentId,
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
      documentId,
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
    return async (request, h) => addSettlementsToKafkaQueue(runtime, request)
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
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v2/publishers/settlement/submit').config(v2.submitSettlement),
  braveHapi.routes.async().post().path('/v2/publishers/settlement').config(v2.settlement)
]

module.exports.initialize = async (debug, runtime) => {
}
