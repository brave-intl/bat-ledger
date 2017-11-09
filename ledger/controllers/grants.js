const Joi = require('joi')
const boom = require('boom')
const bson = require('bson')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveJoi = utils.extras.joi
const braveHapi = utils.extras.hapi

const v1 = {}

const findGrant = async (debug, runtime, paymentId, promotionId) => {
  const query = { active: true, paymentId: { $exists: false } }
  const grants = runtime.database.get('grants', debug)
  let entries, grant, promotions, state

  if (!paymentId) return grants.findOne(query)

  if (promotionId) {
// NB: race condition between these two calls...
    grant = await grants.findOne(underscore.extend(query, { paymentId: paymentId, promotionId: promotionId }))
    if (grant) return null

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: { paymentId: paymentId }
    }
    return grants.findOneAndUpdate(underscore.extend(query, { paymentId: { $exists: false } }), state, { upsert: false })
  }

  promotions = []
  entries = await grants.find({ paymentId: paymentId })
  entries.forEach((entry) => { if (promotions.indexOf(entry.promotionId) === -1) promotions.push(entry.promotionId) })
  return grants.findOne(underscore.extend(query, { promotionId: { $nin: promotions } }))
}

/*
   GET /v1/grants
 */

v1.read = { handler: (runtime) => {
  return async (request, reply) => {
    const paymentId = request.query.paymentId
    const debug = braveHapi.debug(module, request)
    const grant = await findGrant(debug, runtime, paymentId)

    if (!grant) return reply(boom.notFound('no promotions available'))

    reply(underscore.extend(underscore.pick(grant, [ 'promotionId', 'altcurrency' ]), { probi: grant.probi.toString() }))
  }
},
  description: 'See if a grant is available',
  tags: [ 'api' ],

  validate: {
    query: { paymentId: Joi.string().guid().optional().description('identity of the wallet') }
  },

  response: {
    schema: Joi.object().keys({
      promotionId: Joi.string().required().description('the promotion-identifier'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the grant altcurrency'),
      probi: braveJoi.string().numeric().description('the grant amount in probi')
    }).unknown(true).description('properties of an available promotion')
  }
}

/*
   PUT /v1/grants/{paymentId}
 */

v1.write = { handler: (runtime) => {
  return async (request, reply) => {
    const paymentId = request.params.paymentId.toLowerCase()
    const promotionId = request.payload.promotionId
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)
    let grant, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    grant = await findGrant(debug, runtime, paymentId, promotionId)
    if (grant === null) return reply(boom.badData('promotion already in use'))

    if (!grant) return reply(boom.notFound('no promotions available'))

    reply({})
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

  response:
    { schema: Joi.object().length(0) }
}

/*
   POST /v1/grants
 */

v1.create =
{ handler: (runtime) => {
  return async (request, reply) => {
    const entries = request.payload
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    let state

    for (let entry of entries) {
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.pick(entry, [ 'active', 'promotionId', 'altcurrency', 'grantSignature' ]),
                                { probi: bson.Decimal128.fromString(entry.probi) })
      }
      await grants.update({ grantId: entry.grantId }, state, { upsert: true })
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
    payload: Joi.array().min(1).items(Joi.object().keys({
      grantId: Joi.string().required().description('the grant-identifier'),
      active: Joi.boolean().optional().default(true).description('the grant status'),
      promotionId: Joi.string().required().description('the promotion-identifier'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the grant altcurrency'),
      probi: braveJoi.string().numeric().description('the grant amount in probi'),
      grantSignature: Joi.string().required().description('the grant-signature')
    })).required().description('bulk grants for upload')
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
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
        active: false,

        promotionId: '',
        altcurrency: '',
        probi: '0',

        grantSignature: '',

        paymentId: '',

        count: 0,
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { grantId: 1 } ],
      others: [ { active: 1 },
                { promotionId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { paymentId: '' },
                { timestamp: 1 } ]
    }
  ])
}
