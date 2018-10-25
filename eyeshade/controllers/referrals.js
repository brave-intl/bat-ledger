const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const {
  insertFromReferrals,
  updateBalances
} = require('../lib/transaction')

const v1 = {}
let altcurrency = null

const authorizationHeader = Joi.object({
  authorization: Joi.string().required()
}).unknown()

const channelId = braveJoi.string().publisher().required().description('the publisher identity')
const transactionId = Joi.string().guid().required().description('the transaction identity')
const ownerId = braveJoi.string().owner().required().description('the owner')
const amount = braveJoi.number().required().description('amount awarded for the referral')

const joiPublisher = Joi.object().keys({
  ownerId,
  channelId
})
const joiReferral = Joi.object().keys({
  channelId,
  ownerId,
  amount,
  transactionId
})
const joiPublishers = Joi.array().items(joiPublisher).required().description('list of requested referral creations')
const joiReferrals = Joi.array().items(joiReferral).required().description('list of finalized referrals')

/*
   GET /v1/referrals/{transactionID}
 */

v1.findReferrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const {
        transactionId
      } = request.params

      const entries = await getByTransactionIds(runtime, [transactionId])

      if (entries.length === 0) {
        return reply(boom.notFound('no such transaction-identifier: ' + transactionId))
      }

      reply(entries)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Returns referral transactions for a publisher',
  tags: [ 'api', 'referrals' ],

  validate: {
    headers: authorizationHeader,
    params: {
      transactionId: transactionId
    }
  },

  response: {
    schema: joiReferrals
  }
}

/*
   PUT /v1/referrals/{transactionID}
       [ used by referrals ]
 */

v1.createReferrals = {
  handler: (runtime) => {
    return async (request, reply) => {
      const { transactionId } = request.params
      const referrals = request.payload

      const byTxId = await getByTransactionIds(runtime, [transactionId])

      if (byTxId.length > 0) {
        const message = 'existing transaction-identifier: ' + transactionId
        return reply(boom.badData(message))
      }

      const {
        amount,
        currency
      } = runtime.config.referrals

      const probi = await runtime.currency.fiat2alt(currency, amount, altcurrency)
      const probiString = probi.toString()

      const options = {
        probi: probiString,
        altcurrency,
        transactionId
      }
      await insertReferrals(runtime, options, referrals)
      const created = await getByTransactionIds(runtime, [transactionId])

      reply(created)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Records referral transactions for a publisher',
  tags: [ 'api', 'referrals' ],

  validate: {
    headers: authorizationHeader,
    payload: joiPublishers,
    params: {
      transactionId: transactionId
    }
  },

  response: {
    schema: joiReferrals
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/referrals/{transactionId}').whitelist().config(v1.findReferrals),
  braveHapi.routes.async().put().path('/v1/referrals/{transactionId}').whitelist().config(v1.createReferrals)
]

module.exports.removeReferral = removeReferral
module.exports.insertReferrals = insertReferrals
module.exports.getByTransactionIds = getByTransactionIds

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'
}

async function getByTransactionIds (runtime, transactionIds) {
  const query = `
SELECT
  TX.document_id as "transactionId",
  TX.to_account as "ownerId",
  TX.channel as "channelId",
  amount
FROM transactions as TX
WHERE
  TX.document_id = any($1::text[]);`
  const {
    rows
  } = await runtime.postgres.query(query, [transactionIds])
  return rows
}

function removeReferral (runtime, transactionId) {
  const query = `
DELETE FROM transactions WHERE document_id = $1;`
  return runtime.postgres.query(query, [transactionId])
}

async function insertReferrals (runtime, options, referrals) {
  return runtime.postgres.transaction(async (client) => {
    const inserter = insertReferral(runtime, client, options)
    const result = await Promise.all(referrals.map(inserter))
    await updateBalances(runtime, client)
    return result
  })
}

function insertReferral (runtime, client, {
  probi,
  altcurrency,
  transactionId
}) {
  return ({
    channelId,
    ownerId
  }) => {
    const firstId = bson.ObjectID.createFromTime(new Date())
    const _id = {
      publisher: channelId,
      owner: ownerId,
      altcurrency: altcurrency || runtime.config.altcurrency || 'BAT'
    }
    return insertFromReferrals(runtime, client, {
      transactionId,
      firstId,
      probi,
      _id
    })
  }
}
