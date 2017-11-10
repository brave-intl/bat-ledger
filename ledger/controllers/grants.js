const BigNumber = require('bignumber.js')
const Joi = require('joi')
const boom = require('boom')
const bson = require('bson')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveJoi = utils.extras.joi
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/promotions
 */

v1.all = { handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const promotions = runtime.database.get('promotions', debug)
    let entries, results

    entries = await promotions.find({}, { sort: { priority: 1 } })

    results = []
    entries.forEach((entry) => {
      if (entry.promotionId === '') return

      results.push(underscore.omit(entry, [ '_id', 'batchId', 'timestamp' ]))
    })
    console.log(JSON.stringify(results, null, 2))
    reply(results)
  }
},
  description: 'See if a promotion is available',
  tags: [ 'api' ],

  validate: { query: {} },

  response: {
    schema: Joi.array().min(0).items(Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).unknown(true).description('promotion properties'))
  }
}

/*
   GET /v1/grants
 */

v1.read = { handler: (runtime) => {
  return async (request, reply) => {
    const paymentId = request.query.paymentId
    const query = { active: true, count: { $gt: 0 } }
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    let entries, promotion, promotionIds

    if (paymentId) {
      promotionIds = []
      entries = await grants.find({ paymentId: paymentId })
      entries.forEach((entry) => { promotionIds.push(entry.promotionId) })
      underscore.extend(query, { promotionId: { $nin: promotionIds } })
    }

    entries = await promotions.find(query, { sort: { priority: 1 } })
    promotion = entries && entries[0]
    if (!promotion) return reply(boom.notFound('no promotions available'))

    reply(underscore.omit(promotion, [ '_id', 'priority', 'active', 'count', 'batchId', 'timestamp' ]))
  }
},
  description: 'See if a promotion is available',
  tags: [ 'api' ],

  validate: {
    query: { paymentId: Joi.string().guid().optional().description('identity of the wallet') }
  },

  response: {
    schema: Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).unknown(true).description('promotion properties')
  }
}

/*
   PUT /v1/grants/{paymentId}
 */

v1.write = { handler: (runtime) => {
  return async (request, reply) => {
    const paymentId = request.params.paymentId.toLowerCase()
    const promotionId = request.payload.promotionId
    const query = { active: true, paymentId: paymentId, promotionId: promotionId }
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    const wallets = runtime.database.get('wallets', debug)
    let count, grant, result, state, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    grant = await grants.findOne(query)
    if (grant) return reply(boom.badData('promotion already in use'))

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: { paymentId: paymentId }
    }
    underscore.extend(query, { paymentId: { $exists: false } })
    grant = await grants.findOneAndUpdate(query, state, { upsert: false })
    if (!grant) return reply(boom.notFound('no promotions available'))

    count = await grants.count({ promotionId: promotionId, paymentId: paymentId })
    if (count !== 1) {    // race condition!
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $unset: { paymentId: '' }
      }
      await grants.update({ _id: grant._id }, state, { upsert: false })
      return reply(boom.badData('promotion already in use'))
    }

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $inc: { count: -1 }
    }
    await promotions.update({ promotionId: promotionId }, state, { upsert: true })

    result = underscore.extend(underscore.pick(grant, [ 'grantId', 'altcurrency' ]),
                               { probi: new BigNumber(grant.probi.toString()).toString() })
    await runtime.queue.send(debug, 'grant-report',
                             underscore.extend({ paymentId: paymentId, promotionId: promotionId }, result))

    return reply(result)
  }
},
  description: 'Request a grant for a wallet',
  tags: [ 'api' ],

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },

    payload: Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier')
    }).required().description('promotion derails')
  },

  response: {
    schema: Joi.object().keys({
      grantId: Joi.string().required().description('the grant-identifier'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the grant altcurrency'),
      probi: braveJoi.string().numeric().description('the grant amount in probi')
    }).unknown(true).description('grant properties')
  }
}

/*
   POST /v1/grants
 */

v1.create =
{ handler: (runtime) => {
  return async (request, reply) => {
    const payload = request.payload
    const batchId = uuid.v4().toLowerCase()
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    let count, state

    const oops = async (ex) => {
      try {
        await grants.remove({ batchId: batchId }, { justOne: false })
      } catch (ex2) {
        runtime.captureException(ex2, { req: request, extra: { collection: 'grants', batchId: 'batchId' } })
      }
      try {
        await promotions.remove({ batchId: batchId }, { justOne: false })
      } catch (ex2) {
        runtime.captureException(ex2, { req: request, extra: { collection: 'promotions', batchId: 'batchId' } })
      }

      return boom.boomify(ex, { statusCode: 422 })
    }

    for (let entry of payload.grants) {
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.pick(entry, [ 'promotionId', 'altcurrency', 'grantSignature' ]),
                                { probi: bson.Decimal128.fromString(entry.probi), batchId: batchId })
      }
      try {
        await grants.update({ grantId: entry.grantId }, state, { upsert: true })
      } catch (ex) { return oops(ex) }
    }

    for (let entry of payload.promotions) {
      try {
        count = await grants.count({ promotionId: entry.promotionId, paymentId: { $exists: false } })
      } catch (ex) { return oops(ex) }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.omit(entry, [ 'promotionId' ]), { batchId: batchId, count: count })
      }
      try {
        await promotions.update({ promotionId: entry.promotionId }, state, { upsert: true })
      } catch (ex) { return oops(ex) }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.pick(entry, [ 'active', 'priority' ])
      }
      try {
        await grants.update({ promotionId: entry.promotionId }, state, { upsert: false, multi: true })
      } catch (ex) { return oops(ex) }
    }

    reply({})
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Defines the list of ledger balance providers',
  tags: [ 'api' ],

  validate: {
    payload: Joi.object().keys({
      grants: Joi.array().min(0).items(Joi.object().keys({
        grantId: Joi.string().required().description('the grant-identifier'),
        promotionId: Joi.string().required().description('the associated promotion'),
        altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the grant altcurrency'),
        probi: braveJoi.string().numeric().description('the grant amount in probi'),
        grantSignature: Joi.string().required().description('the grant-signature')
      })).description('grants for bulk upload'),
      promotions: Joi.array().min(0).items(Joi.object().keys({
        promotionId: Joi.string().required().description('the promotion-identifier'),
        priority: Joi.number().integer().min(0).required().description('the promotion priority (lower is better)'),
        active: Joi.boolean().optional().default(true).description('the promotion status')
      }).unknown(true).description('promotions for bulk upload'))
    }).required().description('data for bulk upload')
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/promotions').config(v1.all),
  braveHapi.routes.async().path('/v1/grants').config(v1.read),
  braveHapi.routes.async().put().path('/v1/grants/{paymentId}').config(v1.write),
  braveHapi.routes.async().post().path('/v1/grants').config(v1.create)
]

module.exports.initialize = async (debug, runtime) => {
  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('grants', debug),
      name: 'grants',
      property: 'grantId',
      empty: {
        grantId: '',

        promotionId: '',
        altcurrency: '',
        probi: '0',

        grantSignature: '',

        // duplicated from promotion to avoid having to do an aggregation pipeline
        active: false,
        priority: 99999,

        paymentId: '',
        redeemed: false,

        batchId: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { grantId: 1 } ],
      others: [ { promotionId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { active: 1 }, { priority: 1 },
                { paymentId: 1 }, { redeemed: 1 },
                { batchId: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('promotions', debug),
      name: 'promotions',
      property: 'promotionId',
      empty: {
        promotionId: '',
        priority: 99999,

        active: false,
        count: 0,

        batchId: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { promotionId: 1 }, { priority: 1 } ],
      others: [ { active: 1 }, { count: 1 },
                { batchId: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('grant-report')
}
