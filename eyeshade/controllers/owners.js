const url = require('url')

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const getPublisherProps = require('bat-publisher').getPublisherProps
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const incrPrometheus = require('./publishers').incrPrometheus

const v1 = {}

let altcurrency

/*
   POST /v1/owners
       [ used by publishers ]
*/

v1.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const authorizer = payload.authorizer
      const info = payload.contactInfo
      const providers = payload.providers
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let props, state

      props = getPublisherProps(authorizer.owner)
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.omit(authorizer, [ 'owner' ]), {
          authorized: true,
          altcurrency: altcurrency,
          info: info
        }, underscore.pick(props, [ 'providerName', 'providerSuffix', 'providerValue' ]))
      }
      await owners.update({ owner: authorizer.owner }, state, { upsert: true })

      for (let entry of providers) {
        state.$set = underscore.extend(underscore.omit(entry, [ 'publisher', 'show_verification_status' ]), {
          verified: true,
          authorized: true,
          authority: authorizer.owner,
          owner: authorizer.owner,
          visible: entry.show_verification_status || false,
          altcurrency: altcurrency,
          info: info
        })
        await publishers.update({ publisher: entry.publisher }, state, { upsert: true })

        incrPrometheus(debug, runtime, getPublisherProps(entry.publisher), state.$set)

        entry.verificationId = uuid.v4().toLowerCase()
        state.$set = underscore.extend(underscore.pick(state.$set, [ 'verified', 'visible' ]), {
          token: entry.verificationId,
          reason: 'bulk loaded',
          authority: authorizer.owner,
          info: info
        })
        await tokens.update({ publisher: entry.publisher, verificationId: entry.verificationId }, state, { upsert: true })

        await runtime.queue.send(debug, 'publisher-report',
                                 underscore.extend({ publisher: entry.publisher },
                                                   underscore.pick(state.$set, [ 'verified', 'visible' ])))
      }

      reply({})
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
      authorizer: Joi.object().keys({
        owner: braveJoi.string().owner().required().description('the owner identity'),
        ownerEmail: Joi.string().email().optional().description('authorizer email address'),
        ownerName: Joi.string().optional().description('authorizer name')
      }),
      contactInfo: Joi.object().keys({
        name: Joi.string().required().description('authorizer name'),
        phone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).optional().description('phone number for owner'),
        email: Joi.string().email().required().description('verified email address for owner')
      }),
      providers: Joi.array().min(1).items(Joi.object().keys({
        publisher: braveJoi.string().publisher().required().description('the publisher identity'),
        show_verification_status: Joi.boolean().optional().default(true).description('public display authorized')
      }))
    }).required().description('publisher bulk entries for owner')
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
        if (provider && entry.parameters) result.wallet = await runtime.wallet.status(entry)
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
        const props = getPublisherProps(entry.publisher)

        if (props && props.URL) sites.push(props.URL)
      })
      if (sites.length === 0) sites.push('none')
      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: 'owner ' + entry.ownerName + ' <' + entry.ownerEmail + '> ' + owner + ' registered with ' + provider + ': ' +
          sites.join(' ')
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

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/owners').whitelist().config(v1.bulk),
  braveHapi.routes.async().path('/v1/owners/{owner}/wallet').whitelist().config(v1.getWallet),
  braveHapi.routes.async().put().path('/v1/owners/{owner}/wallet').whitelist().config(v1.putWallet),
  braveHapi.routes.async().path('/v1/owners/{owner}/statement').whitelist().config(v1.getStatement)
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
        ownerEmail: '',         // profile.email
        ownerName: '',          // profile.username || profile.user
        ownerPhone: '',
        verifiedEmail: '',

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
      others: [ { ownerEmail: 1 }, { ownerName: 1 }, { verifiedEmail: 1 },
                { providerName: 1 }, { providerSuffix: 1 },
                { authorized: 1 }, { authority: 1 },
                { provider: 1 }, { altcurrency: 1 },
                { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('publisher-report')
}
