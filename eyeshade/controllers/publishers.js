const url = require('url')

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const batPublisher = require('bat-publisher')
const getPublisher = batPublisher.getPublisher
const getPublisherProps = batPublisher.getPublisherProps
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
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
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      const settlements = runtime.database.get('settlements', debug)
      const fields = [ 'probi', 'amount', 'fee', 'fees', 'commission' ]
      let entry, owner, publisher, state

      for (entry of payload) {
        if (entry.altcurrency !== altcurrency) return reply(boom.badData('altcurrency should be ' + altcurrency))

        publisher = await publishers.findOne({ publisher: entry.publisher })
        if (!publisher) return reply(boom.badData('no such entry: ' + entry.publisher))

        // The owner at the time of uploading could be different
        owner = await owners.findOne({ owner: entry.owner })
        if (!owner) return reply(boom.badData('no such owner ' + publisher.owner + ' for entry: ' + entry.publisher))
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

/*
   GET /v2/publishers/{publisher}/balance
       [ used by publishers ]
 */

v2.getBalance = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const referrals = runtime.database.get('referrals', debug)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = new BigNumber(summary[0].probi.toString())

      summary = await referrals.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.plus(new BigNumber(summary[0].probi.toString()))

      summary = await settlements.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher }
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) probi = new BigNumber(0)

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      reply({
        rates: runtime.currency.rates[altcurrency],
        altcurrency: altcurrency,
        probi: probi.truncated().toString(),
        amount: amount,
        currency: currency
      })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets the balance for a verified publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency') }
  },

  response: {
    schema: Joi.object().keys({
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
      probi: braveJoi.string().numeric().optional().description('the balance in probi'),
      amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency')
    })
  }
}

/*
   GET /v2/publishers/{publisher}/wallet
       [ used by publishers ]
 */

v2.getWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const referrals = runtime.database.get('referrals', debug)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, entries, entry, provider, rates, result, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = new BigNumber(summary[0].probi.toString())

      summary = await referrals.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.plus(new BigNumber(summary[0].probi.toString()))

      summary = await settlements.aggregate([
        {
          $match: {
            probi: { $gt: 0 },
            publisher: { $eq: publisher }
          }
        },
        {
          $group: {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) {
        runtime.captureException(new Error('negative probi'), { extra: { publisher: publisher, probi: probi.toString() } })
        probi = new BigNumber(0)
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

      entries = await settlements.find({ publisher: publisher }, { sort: { timestamp: -1 }, limit: 1 })
      entry = entries && entries[0]
      if (entry) {
        result.lastSettlement = underscore.extend(underscore.pick(entry, [ 'altcurrency', 'currency' ]), {
          probi: entry.probi.toString(),
          amount: entry.amount.toString(),
          timestamp: (entry.timestamp.high_ * 1000) +
            (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
        })
      }

      entry = await publishers.findOne({ publisher: publisher })
      provider = entry && entry.provider
      try {
        if (provider && entry.parameters) result.wallet = await runtime.wallet.status(entry)
        if (result.wallet) {
          result.wallet = underscore.pick(result.wallet, [ 'provider', 'authorized', 'defaultCurrency', 'availableCurrencies' ])
          rates = result.rates

          underscore.union([ result.wallet.defaultCurrency ], result.wallet.availableCurrencies).forEach((currency) => {
            const fxrates = runtime.currency.fxrates

            if ((rates[currency]) || (!rates[fxrates.base]) || (!fxrates.rates[currency])) return

            rates[currency] = rates[fxrates.base] * fxrates.rates[currency]
          })
        }
      } catch (ex) {
        debug('status', { reason: ex.toString(), stack: ex.stack })
        runtime.captureException(ex, { req: request, extra: { publisher: publisher } })
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

  description: 'Gets wallet information for a publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency') }
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
        defaultCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the default currency to pay a publisher in'),
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
   GET /v1/publishers/identity?url=...
       [ used by publishers ]
 */

v1.identity =
{ handler: (runtime) => {
  return async (request, reply) => {
    const url = request.query.url
    const debug = braveHapi.debug(module, request)
    let result

    try {
      result = getPublisherProps(url)
      if (!result) return reply(boom.notFound())

      if (!result.publisherType) {
        result.publisher = getPublisher(url, ruleset)
        if (result.publisher) underscore.extend(result, await identity(debug, runtime, result))
      }

      reply(result)
    } catch (ex) {
      reply(boom.badData(ex.toString()))
    }
  }
},

  description: 'Returns the publisher identity associated with a URL',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    query: { url: Joi.string().uri({ scheme: /https?/ }).required().description('the URL to parse') }
  },

  response:
    { schema: Joi.object().optional().description('the publisher identity') }
}

const ruleset = [
  {
    'condition': '/^[a-z][a-z].gov$/.test(SLD)',
    'consequent': 'QLD + "." + SLD',
    'description': 'governmental sites'
  },
  {
    'condition': "TLD === 'gov' || /^go.[a-z][a-z]$/.test(TLD) || /^gov.[a-z][a-z]$/.test(TLD)",
    'consequent': 'SLD',
    'description': 'governmental sites'
  },
  {
    'condition': "SLD === 'keybase.pub'",
    'consequent': "QLD + '.' + SLD",
    'description': 'keybase users'
  },
  {
    'condition': true,
    'consequent': 'SLD',
    'description': 'the default rule'
  }
]

const identity = async (debug, runtime, result) => {
  const publishersV2 = runtime.database.get('publishersV2', debug)
  let entry

  const re = (value, entries) => {
    entries.forEach((reEntry) => {
      let regexp

      if ((entry) ||
          (underscore.intersection(reEntry.publisher.split(''),
                                [ '^', '$', '*', '+', '?', '[', '(', '{', '|' ]).length === 0)) return

      try {
        regexp = new RegExp(reEntry.publisher)
        if (regexp.test(value)) entry = reEntry
      } catch (ex) {
        debug('invalid regexp ' + reEntry.publisher + ': ' + ex.toString())
      }
    })
  }

  entry = await publishersV2.findOne({ publisher: result.publisher, facet: 'domain' })

  if (!entry) entry = await publishersV2.findOne({ publisher: result.SLD.split('.')[0], facet: 'SLD' })
  if (!entry) re(result.SLD, await publishersV2.find({ facet: 'SLD' }))

  if (!entry) entry = await publishersV2.findOne({ publisher: result.TLD, facet: 'TLD' })
  if (!entry) re(result.TLD, await publishersV2.find({ facet: 'TLD' }))

  if (!entry) return {}

  return {
    properties: underscore.omit(entry, [ '_id', 'publisher', 'timestamp' ]),
    timestamp: entry.timestamp.toString()
  }
}

/*
   GET /v1/publishers/statement
 */

v1.getStatements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, underscore.extend(request.info, { protocol: runtime.config.server.protocol })))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL },
                                                   request.query,
                                                   { authority: 'automated', summary: true }))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Generates a statement for all publishers',
  tags: [ 'api' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown()
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    })
  }
}

/*
   GET /v1/publishers/{publisher}/statement
       [ used by publishers ]
 */

v1.getStatement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, underscore.extend(request.info, { protocol: runtime.config.server.protocol })))
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let entry

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, publisher: publisher },
                                                   request.query,
                                                   { authority: 'automated', summary: true }))
      reply({ reportURL: reportURL })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Generates a statement for a publisher',
  tags: [ 'api', 'publishers' ],

  validate: {
    headers: Joi.object({ authorization: Joi.string().required() }).unknown(),
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      starting: Joi.date().iso().optional().description('starting timestamp in ISO 8601 format'),
      ending: Joi.date().iso().optional().description('ending timestamp in ISO 8601 format')
    }
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v2/publishers/settlement').config(v2.settlement),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/balance').whitelist().config(v2.getBalance),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.getWallet),
  braveHapi.routes.async().path('/v1/publishers/identity').whitelist().config(v1.identity),
  braveHapi.routes.async().path('/v1/publishers/statement').whitelist().config(v1.getStatements),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/statement').whitelist().config(v1.getStatement)
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
