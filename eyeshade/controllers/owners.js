const querystring = require('querystring')
const url = require('url')

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const batPublisher = require('bat-publisher')
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const verifier = require('./publishers.js')
const getToken = verifier.getToken
const putToken = verifier.putToken

const v1 = {}
const v2 = {}

let altcurrency

const ownerString = (owner, info) => {
  const name = info && (info.name || info.ownerName)
  const email = info && (info.email || info.ownerEmail)
  let result = name

  if (result && email) result += ' <' + email + '>'
  if (result) result += ' '
  result += owner

  return result
}

/*
   POST /v1/owners
       [ used by publishers ]
*/

v1.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      const authorizer = request.payload.authorizer
      const providers = request.payload.providers || []
      const channels = []
      let info = {}

      if (authorizer.ownerEmail || authorizer.ownerName) info = { email: authorizer.ownerEmail, name: authorizer.ownerName }
      providers.forEach((provider) => {
        channels.push(underscore.extend({ channeId: provider.publisher, visible: provider.show_verification_status }, info))
      })

      bulk(request, reply, runtime, authorizer.owner, request.payload.contactInfo, channels)
    }
  },
  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Creates publisher entries in bulk',
  tags: [ 'api', 'deprecated' ],

  validate: {
    query: {
      access_token: Joi.string().guid().optional()
    },
    payload: Joi.object().keys({
      authorizer: Joi.object().keys({
        owner: braveJoi.string().owner().required().description('the owner identity'),
        ownerEmail: Joi.string().email().optional().description('authorizer email address'),
        ownerName: Joi.string().optional().description('authorizer name')
      }).required(),
      contactInfo: Joi.object().keys({
        name: Joi.string().required().description('authorizer name'),
        phone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).optional().description('phone number for owner'),
        email: Joi.string().email().required().description('verified email address for owner')
      }).optional(),
      providers: Joi.array().min(1).items(Joi.object().keys({
        publisher: braveJoi.string().publisher().required().description('the publisher identity'),
        show_verification_status: Joi.boolean().optional().default(true).description('public display authorized')
      }).optional())
    }).required().description('publisher bulk entries for owner')
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   POST /v2/owners
       [ used by publishers ]
*/

v2.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      bulk(request, reply, runtime, request.payload.ownerId, request.payload.contactInfo, request.payload.channels)
    }
  },
  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Creates publisher entries in bulk',
  tags: [ 'api' ],

  validate: {
    query: {
      access_token: Joi.string().guid().optional()
    },
    payload: Joi.object().keys({
      ownerId: braveJoi.string().owner().required().description('the owner identity'),
      contactInfo: Joi.object().keys({
        name: Joi.string().optional().description('owner name'),
        phone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).optional().description('owner phone number'),
        email: Joi.string().email().required().description('owner verified email address')
      }).optional(),
      channels: Joi.array().min(1).items(Joi.object().keys({
        channelId: braveJoi.string().publisher().required().description('the publisher identity'),
        visible: Joi.boolean().optional().default(true).description('promotional display authorized'),
        authorizerEmail: Joi.string().email().optional().description('authorizer email address'),
        authorizerName: Joi.string().optional().description('authorizer name')
      }).optional())
    }).required().description('publisher bulk entries for owner')
  },

  response:
    { schema: Joi.object().length(0) }
}

const bulk = async (request, reply, runtime, owner, info, channels) => {
  const debug = braveHapi.debug(module, request)
  const owners = runtime.database.get('owners', debug)
  const publishers = runtime.database.get('publishers', debug)
  const tokens = runtime.database.get('tokens', debug)
  let props, state

  props = batPublisher.getPublisherProps(owner)
  if (!props) return reply(boom.notFound('no such entry: ' + owner))

  for (let channel of channels) {
    if (!batPublisher.getPublisherProps(channel.channelId)) return reply(boom.notFound('no such entry: ' + channel.channelId))
  }

  if (!info) info = {}
  if (!channels) channels = []

  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: underscore.extend({
      authorized: true,
      altcurrency: altcurrency,
      info: info
    }, underscore.pick(props, [ 'providerName', 'providerSuffix', 'providerValue' ]))
  }
  await owners.update({ owner: owner }, state, { upsert: true })

  for (let channel of channels) {
    const previous = await publishers.findOne({ publisher: channel.channelId })

    if ((previous) && (previous.owner) && (previous.owner !== owner)) {
      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: 'new owner ' + ownerString(owner, info) + 'for ' + channel.channelId + ', previously' +
          ownerString(previous.owner, previous.info)
      })
    }

    props = batPublisher.getPublisherProps(channel.channelId)

    state.$set = underscore.extend(underscore.omit(channel, [ 'channelId' ]), {
      verified: true,
      authorized: true,
      authority: owner,
      owner: owner,
      altcurrency: altcurrency,
      info: underscore.defaults({ name: channel.authorizerName, email: channel.authorizerEmail }, info)
    }, underscore.pick(props, [ 'providerName', 'providerSuffix', 'providerValue' ]))

    await publishers.update({ publisher: channel.channelId }, state, { upsert: true })

    channel.verificationId = uuid.v4().toLowerCase()
    state.$set = underscore.extend(underscore.pick(state.$set, [ 'verified', 'visible' ]), {
      token: channel.verificationId,
      reason: 'bulk loaded',
      authority: owner,
      info: info
    })
    await tokens.update({ publisher: channel.channelId, verificationId: channel.verificationId }, state, { upsert: true })

    await runtime.queue.send(debug, 'publisher-report',
                             underscore.extend({ owner: owner, publisher: channel.channelId },
                                               underscore.pick(state.$set, [ 'verified', 'visible' ])))
  }

  reply({})
}

/*
   DELETE /v1/owners/{owner}/{publisher}
       [ used by publishers ]
 */

v1.deletePublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const publisher = request.params.publisher
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      let entry, state

      entry = await owners.findOne({ owner: owner })
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      entry = await publishers.findOne({ owner: owner, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $unset: { owner: '' }
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Unlinks a publisher from an owner',
  tags: [ 'api' ],

  validate: {
    params: {
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().required().description('the publisher identity')
    },
    query: {
      access_token: Joi.string().guid().optional()
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/owners/{owner}/wallet
       [ used by publishers ]
 */

v1.getWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, entries, entry, provider, rates, result, summary
      let probi = new BigNumber(0)

      entry = await owners.findOne({ owner: owner })
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      summary = await voting.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            owner: { $eq: owner },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group:
          {
            _id: '$owner',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = new BigNumber(summary[0].probi.toString())

      summary = await settlements.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            owner: { $eq: owner }
          }
        },
        {
          $group:
          {
            _id: '$owner',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) {
        runtime.captureException(new Error('negative probi'), { extra: { owner: owner, probi: probi.toString() } })
        probi = 0
      }

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      result = {
        rates: runtime.currency.rates[altcurrency],
        contributions: {
          amount: amount,
          currency: currency,
          altcurrency: altcurrency,
          probi: probi.truncated().toString()
        }
      }

      entries = await settlements.find({ owner: owner }, { sort: { timestamp: -1 }, limit: 1 })
      entry = entries && entries[0]
      if (entry) {
        result.lastSettlement = underscore.extend(underscore.pick(entry, [ 'altcurrency', 'currency' ]), {
          probi: entry.probi.toString(),
          amount: entry.amount.toString(),
          timestamp: (entry.timestamp.high_ * 1000) +
            (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
        })
      }

      entry = await owners.findOne({ owner: owner })
      provider = entry && entry.provider
      try {
        if (provider) result.wallet = await runtime.wallet.status(entry)
        if (result.wallet) {
          result.wallet = underscore.pick(result.wallet, [ 'provider', 'authorized', 'preferredCurrency', 'availableCurrencies' ])
          rates = result.rates

          underscore.union([ result.wallet.preferredCurrency ], result.wallet.availableCurrencies).forEach((currency) => {
            const fxrates = runtime.currency.fxrates

            if ((rates[currency]) || (!rates[fxrates.base]) || (!fxrates.rates[currency])) return

            rates[currency] = rates[fxrates.base] * fxrates.rates[currency]
          })
        }
      } catch (ex) {
        debug('status', { reason: ex.toString(), stack: ex.stack })
        runtime.captureException(ex, { req: request, extra: { owner: owner } })
      }
      if ((provider) && (!result.wallet)) {
        result.status = { provider: entry.provider, action: entry.parameters ? 're-authorize' : 'authorize' }
      }

      reply(result)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets information for a publisher',
  tags: [ 'api' ],

  validate: {
    params: { owner: braveJoi.string().owner().required().description('the owner identity') },
    query: {
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
      access_token: Joi.string().guid().optional()
    }
  },

  response: {
    schema: Joi.object().keys({
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      contributions: Joi.object().keys({
        amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
        currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
        altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
        probi: braveJoi.string().numeric().optional().description('the balance in probi')
      }).unknown(true).required().description('pending publisher contributions'),
      lastSettlement: Joi.object().keys({
        altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
        probi: braveJoi.string().numeric().required().description('the balance in probi'),
        currency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the deposit currency'),
        amount: braveJoi.string().numeric().optional().description('the amount in the deposit currency'),
        timestamp: Joi.number().positive().optional().description('timestamp of settlement')
      }).unknown(true).optional().description('last publisher settlement'),
      wallet: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        authorized: Joi.boolean().optional().description('publisher is authorized by provider'),
        preferredCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the preferred currency'),
        availableCurrencies: Joi.array().items(braveJoi.string().anycurrencyCode()).description('available currencies')
      }).unknown(true).optional().description('publisher wallet information'),
      status: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        action: Joi.any().allow([ 'authorize', 're-authorize' ]).required().description('requested action')
      }).unknown(true).optional().description('publisher wallet status')
    })
  }
}

/*
   PUT /v1/owners/{owner}/wallet
       [ used by publishers ]
 */

v1.putWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const payload = request.payload
      const provider = payload.provider
      const visible = payload.show_verification_status
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      const sites = []
      let entry, entries, state

      entry = await owners.findOne({ owner: owner })
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(payload, {
          visible: visible, verified: true, altcurrency: altcurrency, authorized: true, authority: provider
        })
      }
      await owners.update({ owner: owner }, state, { upsert: true })

      entries = await publishers.find({ owner: owner })
      entries.forEach((entry) => {
        const props = batPublisher.getPublisherProps(entry.publisher)

        if (props && props.URL) sites.push(props.URL)
      })
      if (sites.length === 0) sites.push('none')
      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: 'owner ' + ownerString(querystring.unescape(owner), entry) + ' ' + ' registered with ' +
          provider + ': ' + sites.join(' ')
      })

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Sets information for a verified publisher',
  tags: [ 'api' ],

  validate: {
    params: { owner: braveJoi.string().owner().required().description('the owner identity') },
    query: { access_token: Joi.string().guid().optional() },
    payload: {
      provider: Joi.string().required().description('wallet provider'),
      parameters: Joi.object().required().description('wallet parameters')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/owner/{owner}/statement
       [ used by publishers ]
 */

v1.getStatement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const owner = request.params.owner
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      let entry

      entry = await owners.findOne({ owner: owner })
      if (!entry) return reply(boom.notFound('no such entry: ' + owner))

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, owner: owner },
                                                   request.query,
                                                   { authority: 'automated', rollup: false, summary: false }))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Generates a statement for a publisher',
  tags: [ 'api' ],

  validate: {
    params: { owner: braveJoi.string().owner().required().description('the owner identity') },
    query: {
      starting: Joi.date().iso().optional().description('starting timestamp in ISO 8601 format'),
      ending: Joi.date().iso().optional().description('ending timestamp in ISO 8601 format'),
      access_token: Joi.string().guid().optional()
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    })
  }
}

/*
   GET /v1/owners/{owner}/verify/{publisher}
       [ used by publishers ]
 */

v1.getToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      getToken(request, reply, runtime, request.params.owner, request.params.publisher, request.query.backgroundP)
    }
  },

  description: 'Verifies a publisher claimed by an owner',
  tags: [ 'api' ],

  validate: {
    params: {
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().required().description('the publisher identity')
    },
    query: { backgroundP: Joi.boolean().optional().default(false).description('running in the background') }
  },

  response: {
    schema: Joi.object().keys({
      status: Joi.string().valid('success', 'failure').required().description('victory is mine!'),
      verificationId: Joi.string().guid().optional().description('identity of the verified requestor')
    })
  }
}

/*
   PUT /v1/owners/{owner}/verify/{publisher}
       [ used by publishers ]
 */

v1.putToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      return putToken(request, reply, runtime, null, request.params.owner, request.params.publisher,
                      request.payload.verificationId, request.query.show_verification_status)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets a verification token for a publisher',
  tags: [ 'api' ],

  validate: {
    params: {
      owner: braveJoi.string().owner().required().description('the owner identity'),
      publisher: braveJoi.string().publisher().required().description('the publisher identity')
    },
    query: {
      access_token: Joi.string().guid().optional(),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    },
    payload: {
      verificationId: Joi.string().guid().required().description('identity of the requestor')
    }
  },

  response:
    { schema: Joi.object().keys({ token: Joi.string().hex().length(64).required().description('verification token') }) }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/owners').whitelist().config(v1.bulk),
  braveHapi.routes.async().post().path('/v2/owners').whitelist().config(v2.bulk),
  braveHapi.routes.async().path('/v1/owners/{owner}/wallet').whitelist().config(v1.getWallet),
  braveHapi.routes.async().put().path('/v1/owners/{owner}/wallet').whitelist().config(v1.putWallet),
  braveHapi.routes.async().path('/v1/owners/{owner}/statement').whitelist().config(v1.getStatement),
  braveHapi.routes.async().path('/v1/owners/{owner}/verify/{publisher}').config(v1.getToken),
  braveHapi.routes.async().put().path('/v1/owners/{owner}/verify/{publisher}').whitelist().config(v1.putToken),
  braveHapi.routes.async().delete().path('/v1/owners/{owner}/{publisher}').whitelist().config(v1.deletePublisher)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('owners', debug),
      name: 'owners',
      property: 'owner',
      empty: {
        owner: '',              // 'oauth#' + provider + ':' + (profile.id || profile._id)

        providerName: '',
        providerSuffix: '',
        providerValue: '',

        authorized: false,
        authority: '',
        provider: '',
        altcurrency: '',
        parameters: {},

        info: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { owner: 1 } ],
      others: [ { providerName: 1 }, { providerSuffix: 1 }, { providerValue: 1 },
                { authorized: 1 }, { authority: 1 },
                { provider: 1 }, { altcurrency: 1 },
                { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('publisher-report')
}
