const Joi = require('joi')
const Netmask = require('netmask').Netmask
const l10nparser = require('accept-language-parser')
const boom = require('boom')
const bson = require('bson')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveJoi = utils.extras.joi
const braveHapi = utils.extras.hapi
const braveUtils = utils.extras.utils
const whitelist = utils.hapi.auth.whitelist

const grantSchema = Joi.object().keys({
  grantId: Joi.string().guid().required().description('the grant-identifier'),
  promotionId: Joi.string().guid().required().description('the associated promotion'),
  altcurrency: braveJoi.string().altcurrencyCode().required().description('the grant altcurrency'),
  probi: braveJoi.string().numeric().required().description('the grant amount in probi'),
  maturityTime: Joi.number().positive().required().description('the time the grant becomes redeemable'),
  expiryTime: Joi.number().positive().required().description('the time the grant expires')
})

const v1 = {}

const qalist = { addresses: process.env.IP_QA_WHITELIST && process.env.IP_QA_WHITELIST.split(',') }

if (qalist.addresses) {
  qalist.authorizedAddrs = []
  qalist.authorizedBlocks = []

  qalist.addresses.forEach((entry) => {
    if ((entry.indexOf('/') === -1) && (entry.split('.').length === 4)) return qalist.authorizedAddrs.push(entry)

    qalist.authorizedBlocks.push(new Netmask(entry))
  })
}

const qaOnlyP = (request) => {
  const ipaddr = whitelist.ipaddr(request)

  return (qalist.authorizedAddrs) && (qalist.authorizedAddrs.indexOf(ipaddr) === -1) &&
    (!underscore.find(qalist.authorizedBlocks, (block) => { return block.contains(ipaddr) }))
}

/*
   GET /v1/promotions
 */

v1.all = { handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const promotions = runtime.database.get('promotions', debug)
    let entries, results

    if (qaOnlyP(request)) return reply(boom.notFound())

    entries = await promotions.find({}, { sort: { priority: 1 } })

    results = []
    entries.forEach((entry) => {
      if (entry.promotionId === '') return

      results.push(underscore.omit(entry, [ '_id', 'batchId', 'timestamp' ]))
    })
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

// from https://github.com/opentable/accept-language-parser/blob/master/index.js#L1
const localeRegExp = /((([a-zA-Z]+(-[a-zA-Z0-9]+){0,2})|\*)(;q=[0-1](\.[0-9]+)?)?)*/g

v1.read = { handler: (runtime) => {
  return async (request, reply) => {
    const lang = request.query.lang
    const paymentId = request.query.paymentId
    const languages = l10nparser.parse(lang)
    const query = { active: true, count: { $gt: 0 } }
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)
    const promotions = runtime.database.get('promotions', debug)
    let candidates, entries, priority, promotion, promotionIds

    const l10n = (o) => {
      const labels = [ 'greeting', 'message', 'text' ]

      for (let key in o) {
        let f = {
          object: () => {
            l10n(o[key])
          },
          string: () => {
            if ((labels.indexOf(key) === -1) && !(key.endsWith('Button') || key.endsWith('Markup') || key.endsWith('Text'))) {
//            return
            }

            // TBD: localization here...
          }
        }[typeof o[key]]
        if (f) f()
      }
    }

    if (qaOnlyP(request)) return reply(boom.notFound())

    if (paymentId) {
      promotionIds = []
      const wallet = await wallets.findOne({ paymentId: paymentId })
      if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))
      if (wallet.grants) {
        wallet.grants.forEach((grant) => { promotionIds.push(grant.promotionId) })
      }
      underscore.extend(query, { promotionId: { $nin: promotionIds } })
    }

    entries = await promotions.find(query)
    if ((!entries) || (!entries[0])) return reply(boom.notFound('no promotions available'))

    candidates = []
    priority = Number.POSITIVE_INFINITY
    entries.forEach((entry) => {
      if (entry.priority > priority) return

      if (priority < entry.priority) {
        candidates = []
        priority = entry.priority
      }
      candidates.push(entry)
    })
    promotion = underscore.shuffle(candidates)[0]

    debug('grants', { languages: languages })
    l10n(promotion)

    reply(underscore.omit(promotion, [ '_id', 'priority', 'active', 'count', 'batchId', 'timestamp' ]))
  }
},
  description: 'See if a promotion is available',
  tags: [ 'api' ],

  validate: {
    query: {
      lang: Joi.string().regex(localeRegExp).optional().default('en').description('the l10n language'),
      paymentId: Joi.string().guid().optional().description('identity of the wallet')
    }
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
    const debug = braveHapi.debug(module, request)
    const grants = runtime.database.get('grants', debug)
    const promotions = runtime.database.get('promotions', debug)
    const wallets = runtime.database.get('wallets', debug)
    let grant, result, state, wallet

    if (!runtime.config.redeemer) return reply(boom.badGateway('not configured for promotions'))

    const promotion = await promotions.findOne({ promotionId: promotionId })
    if (!promotion) return reply(boom.notFound('no such promotion: ' + promotionId))
    if (!promotion.active) return reply(boom.badData('promotion is not active: ' + promotionId))

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    if (wallet.grants && wallet.grants.some(x => x.promotionId === promotionId)) {
      return reply(boom.badData('promotion already applied to wallet'))
    }

    // pop off one grant
    grant = await grants.findOneAndDelete({ status: 'active', promotionId: promotionId })
    if (!grant) return reply(boom.badData('promotion not available'))

    // atomic find & update, only one request is able to add a grant for the given promotion to this wallet
    wallet = await wallets.findOneAndUpdate({ 'paymentId': paymentId, 'grants.promotionId': { '$ne': promotionId } },
                            { $push: { grants: grant } }
    )
    if (!wallet) {
      // reinsert grant, another request already added a grant for this promotion to the wallet
      grants.insertOne(grant)
      return reply(boom.badData('promotion already applied to wallet'))
    }

    if (runtime.config.balance) {
      // invalidate any cached balance
      await braveHapi.wreck.delete(runtime.config.balance.url + '/v2/wallet/' + paymentId + '/balance',
        {
          headers: {
            authorization: 'Bearer ' + runtime.config.balance.access_token,
            'content-type': 'application/json'
          },
          useProxyP: true
        })
    }

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $inc: { count: -1 }
    }
    await promotions.update({ promotionId: promotionId }, state, { upsert: true })

    const grantContent = braveUtils.extractJws(grant.token)

    result = underscore.extend(underscore.pick(grantContent, [ 'altcurrency', 'probi' ]))
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
      altcurrency: braveJoi.string().altcurrencyCode().required().default('BAT').description('the grant altcurrency'),
      probi: braveJoi.string().numeric().required().description('the grant amount in probi')
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

      return reply(boom.boomify(ex, { statusCode: 422 }))
    }

    for (let entry of payload.grants) {
      const grantContent = braveUtils.extractJws(entry)
      const validity = Joi.validate(grantContent, grantSchema)
      if (validity.error) {
        return reply(boom.badData(validity.error))
      }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { token: entry, promotionId: grantContent.promotionId, status: 'active', batchId: batchId }
      }
      try {
        await grants.update({ grantId: grantContent.grantId }, state, { upsert: true })
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

  description: 'Create one or more grants',
  tags: [ 'api' ],

  validate: {
    payload: Joi.object().keys({
      grants: Joi.array().min(0).items(
        Joi.string().required().description('the jws encoded grant')
      ).description('grants for bulk upload'),
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
        token: '',

        // duplicated from "token" for unique
        grantId: '',
        // duplicated from "token" for filtering
        promotionId: '',

        status: '', // active, completed, expired

        batchId: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { grantId: 1 } ],
      others: [ { promotionId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { status: 1 },
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
      unique: [ { promotionId: 1 } ],
      others: [ { active: 1 }, { count: 1 },
                { batchId: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('grant-report')
  await runtime.queue.create('redeem-report')
}
