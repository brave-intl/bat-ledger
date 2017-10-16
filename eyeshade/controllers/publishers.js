const crypto = require('crypto')
const dns = require('dns')
const url = require('url')

const BigNumber = require('bignumber.js')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}

const prefix1 = 'brave-ledger-verification'
const prefix2 = prefix1 + '='

let altcurrency

/*
   POST /v1/publishers
*/

v1.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let publisher, state

      for (let entry of payload) {
        publisher = await publishers.findOne({ publisher: entry.publisher, verified: true })
        if (publisher) return reply(boom.badData('publisher ' + entry.publisher + ' already verified'))
      }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { verified: true, reason: 'bulk loaded', authority: authority }
      }
      for (let entry of payload) {
        entry.verificationId = uuid.v4().toLowerCase()
        underscore.extend(state.$set, { verificationId: entry.verificationId, token: entry.verificationId })
        await tokens.update({ publisher: entry.publisher }, state, { upsert: true })
      }

      await runtime.queue.send(debug, 'publishers-bulk-create',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                   { publishers: payload }, request.query))
      reply({ reportURL: reportURL })
    }
  },
  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Creates publisher entries in bulk',
  tags: [ 'api' ],

  validate: {
    query: { format: Joi.string().valid('json', 'csv').optional().default('json').description('the format of the report') },
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      name: Joi.string().min(1).max(40).required().description('contact name'),
      email: Joi.string().email().required().description('contact email'),
      phone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).required().description('contact phone number'),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true)
  }
}

/*
   POST /v2/publishers/settlement/{hash}
 */

const txHexRegExp = /^(0x)?[A-Fa-f0-9]+$/

v2.settlement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const hash = request.params.hash
      const payload = request.payload
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      let state, validity

      if (!hash) for (let entry of payload) if (!entry.hash) return reply(boom.badData('missing hash for ' + entry.publisher))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { hash: hash }
      }
      for (let entry of payload) {
        if (entry.altcurrency !== altcurrency) return reply(boom.badData('altcurrency should be ' + altcurrency))

        validity = Joi.validate(entry.address, braveJoi.string().altcurrencyAddress(entry.altcurrency))
        if (validity.error) return reply(boom.badData(entry.address + ': ' + validity.error))

        entry.probi = bson.Decimal128.fromString(entry.probi.toString())
        if (entry.fees) entry.fees = bson.Decimal128.fromString(entry.fees.toString())
        if (!entry.hash) entry.hash = hash
        state.$set = underscore.pick(entry, [ 'address', 'altcurrency', 'probi', 'fees', 'hash' ])

        await settlements.update({ settlementId: entry.transactionId, publisher: entry.publisher }, state, { upsert: true })
      }

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
    params: { hash: Joi.string().regex(txHexRegExp).optional().description('transaction hash') },
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      address: Joi.string().required().description('altcurrency address'),
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      probi: braveJoi.string().numeric().required().description('the settlement in probi'),
      transactionId: Joi.string().guid().description('the transactionId'),
      hash: Joi.string().regex(txHexRegExp).optional().description('transaction hash')
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
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group:
          {
            _id: '$publisher',
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
            publisher: { $eq: publisher }
          }
        },
        {
          $group:
          {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) probi = 0

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      reply({
        amount: amount,
        currency: currency,
        altcurrency: altcurrency,
        probi: probi.truncated().toString(),
        rates: runtime.currency.rates[altcurrency]
      })
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets the balance for a verified publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: {
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
      access_token: Joi.string().guid().optional()
    }
  },

  response: {
    schema: Joi.object().keys({
      amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
      probi: braveJoi.string().numeric().optional().description('the balance in probi'),
      rates: Joi.object().optional().description('current exchange rates to various currencies')
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
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, entries, entry, result, summary
      let probi = new BigNumber(0)

      summary = await voting.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: altcurrency },
            exclude: false
          }
        },
        {
          $group:
          {
            _id: '$publisher',
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
            publisher: { $eq: publisher }
          }
        },
        {
          $group:
          {
            _id: '$publisher',
            probi: { $sum: '$probi' }
          }
        }
      ])
      if (summary.length > 0) probi = probi.minus(new BigNumber(summary[0].probi.toString()))
      if (probi.lessThan(0)) probi = 0

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
      console.log(JSON.stringify(entries, null, 2))
      entry = entries && entries[0]
      if (entry) {
        probi = new BigNumber(entry.probi.toString())
        result.lastSettlement = {
          amount: runtime.currency.alt2fiat(altcurrency, probi, currency) || 0,
          currency: currency,
          altcurrency: altcurrency,
          probi: probi.toString(),
          timestamp: (entry.timestamp.high_ * 1000) + (entry.timestamp.low_ / bson.Timestamp.TWO_PWR_32_DBL_)
        }
      }

      entry = await publishers.findOne({ publisher: publisher })
      try {
        if ((entry) && (entry.provider)) result.wallet = await runtime.wallet.status(entry)
      } catch (ex) {
        debug('status', ex)
      }

      reply(result)
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets the balance for a verified publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
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
        amount: Joi.number().min(0).optional().default(0).description('the balance in the fiat currency'),
        currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
        altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency'),
        probi: braveJoi.string().numeric().optional().description('the balance in probi'),
        timestamp: Joi.number().positive().optional().description('timestamp of settlement')
      }).unknown(true).optional().description('last publisher settlement'),
      wallet: Joi.object().keys({
        provider: Joi.string().required().description('wallet provider'),
        authorized: Joi.boolean().optional().description('publisher is authorized by provider'),
        preferredCurrency: braveJoi.string().anycurrencyCode().optional().default('USD').description('the preferred currency'),
        availableCurrencies: Joi.array().items(braveJoi.string().anycurrencyCode()).description('available currencies')
      }).unknown(true).optional().description('publisher wallet information')
    })
  }
}

/*
   PUT /v2/publishers/{publisher}/wallet
       [ used by publishers ]
 */

v2.putWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const payload = request.payload
      const provider = payload.provider
      const verificationId = request.payload.verificationId
      const visible = payload.show_verification_status
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let entry, state

      entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      if (!entry.verified) return reply(boom.badData('not verified: ' + publisher + ' using ' + verificationId))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.omit(payload, [ 'verificationId', 'show_verification_status' ]),
          { visible: visible, verified: true, altcurrency: altcurrency, authorized: true, authority: provider })
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      runtime.notify(debug, {
        channel: '#publishers-bot',
        text: 'publisher ' + publisher + ' registered with ' + provider
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
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { access_token: Joi.string().guid().optional() },
    payload: {
      verificationId: Joi.string().guid().required().description('identity of the requestor'),
      provider: Joi.string().required().description('wallet provider'),
      parameters: Joi.object().required().description('wallet parameters'),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/publishers/statement
       [ used by publishers ]
 */

v1.getStatements = {
  handler: (runtime) => {
    return async (request, reply) => {
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL },
                                                   { authority: 'automated', summary: true }))
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
    query: {
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
   GET /v1/publishers/{publisher}/statement
       [ used by publishers ]
 */

v1.getStatement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const reportId = uuid.v4().toLowerCase()
      const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let entry

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      await runtime.queue.send(debug, 'report-publishers-statements',
                               underscore.defaults({ reportId: reportId, reportURL: reportURL, publisher: publisher },
                                                   request.query,
                                                   { authority: 'automated', summary: false }))
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
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
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
   GET /v1/publishers/{publisher}/verifications/{verificationId}
       [ used by publishers ]
 */

v1.getToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const verificationId = request.params.verificationId
      const visible = request.query.show_verification_status
      const debug = braveHapi.debug(module, request)
      const tokens = runtime.database.get('tokens', debug)
      let entry, state, token

      entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
      if (entry) return reply({ token: entry.token })

      token = crypto.randomBytes(32).toString('hex')
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { token: token }
      }
      await tokens.update({ verificationId: verificationId, publisher: publisher, visible: visible }, state, { upsert: true })

      reply({ token: token })
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
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      verificationId: Joi.string().guid().required().description('identity of the requestor')
    },
    query: {
      access_token: Joi.string().guid().optional(),
      show_verification_status: Joi.boolean().optional().default(true).description('authorizes display')
    }
  },

  response:
    { schema: Joi.object().keys({ token: Joi.string().hex().length(64).required().description('verification token') }) }
}

/*
   PATCH /v2/publishers/{publisher}
 */

v2.patchPublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const payload = request.payload
      const authorized = payload.authorized
      const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let entry, state

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(payload, { authority: authority })
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      if (authorized) await notify(debug, runtime, publisher, { type: 'payments_activated' })

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Sets the authorization state for the publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    payload: {
      authorized: Joi.boolean().optional().default(false).description('authorize the publisher')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   DELETE /v1/publishers/{publisher}
 */

v1.deletePublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const debug = braveHapi.debug(module, request)
      const tokens = runtime.database.get('tokens', debug)
      let entries

      entries = await tokens.find({ publisher: publisher })
      if (entries.length === 0) return reply(boom.notFound('no such entry: ' + publisher))

      if (underscore.findWhere(entries, { verified: true })) {
        return reply(boom.badData('publisher is already verified: ' + publisher))
      }

      await tokens.remove({ publisher: publisher })

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Deletes a non-verified publisher',
  tags: [ 'api' ],

  validate:
    { params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') } },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/publishers/{publisher}/verify
       [ used by publishers ]
 */

const hints = {
  standard: '/.well-known/brave-payments-verification.txt',
  root: '/'
}
const hintsK = underscore.keys(hints)

const dnsTxtResolver = async (domain) => {
  return new Promise((resolve, reject) => {
    dns.resolveTxt(domain, (err, rrset) => {
      if (err) return reject(err)
      resolve(rrset)
    })
  })
}

const webResolver = async (debug, runtime, publisher, path) => {
  debug('webResolver', { publisher: publisher, path: path })
  try {
    debug('webResolver', 'https://' + publisher + path)
    return await braveHapi.wreck.get('https://' + publisher + path,
                                     { redirects: 3, rejectUnauthorized: true, timeout: (5 * 1000) })
  } catch (ex) {
    if (((!ex.isBoom) || (!ex.output) || (ex.output.statusCode !== 504)) && (ex.code !== 'ECONNREFUSED')) {
      debug('webResolver', publisher + ': ' + ex.toString())
    }
    throw ex
  }
}

const verified = async (request, reply, runtime, entry, verified, backgroundP, reason) => {
  const indices = underscore.pick(entry, [ 'verificationId', 'publisher' ])
  const debug = braveHapi.debug(module, request)
  const tokens = runtime.database.get('tokens', debug)
  let message, payload, state

  message = underscore.extend(underscore.clone(indices), { verified: verified, reason: reason })
  debug('verified', message)
  if (/* (!backgroundP) || */ (verified)) {
    runtime.notify(debug, {
      channel: '#publishers-bot',
      text: (verified ? '' : 'not ') + 'verified: ' + JSON.stringify(message)
    })
  }

  entry.verified = verified
  if (reason.indexOf('Error: ') === 0) reason = reason.substr(7)
  if (reason.indexOf('Client request error: ') === 0) reason = reason.substr(22)
  if (reason.indexOf('Hostname/IP doesn\'t match certificate\'s altnames: ') === 0) reason = reason.substr(0, 48)
  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: { verified: entry.verified, reason: reason.substr(0, 64) }
  }
  await tokens.update(indices, state, { upsert: true })

  reason = reason || (verified ? 'ok' : 'unknown')
  payload = underscore.extend(underscore.pick(entry, [ 'verificationId', 'token', 'verified' ]), { status: reason })
  await publish(debug, runtime, 'patch', entry.publisher, '/verifications', payload)
  if (!verified) return

  await runtime.queue.send(debug, 'publisher-report', underscore.pick(entry, [ 'publisher', 'verified', 'visible' ]))
  reply({ status: 'success', verificationId: entry.verificationId })
}

v1.verifyToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const backgroundP = request.query.backgroundP
      const debug = braveHapi.debug(module, request)
      const tokens = runtime.database.get('tokens', debug)
      let data, entries, hint, i, info, j, matchP, pattern, reason, rr, rrset

      entries = await tokens.find({ publisher: publisher })
      if (entries.length === 0) return reply(boom.notFound('no such publisher: ' + publisher))

      for (let entry of entries) {
        if (entry.verified) {
          await runtime.queue.send(debug, 'publisher-report', underscore.pick(entry, [ 'publisher', 'verified', 'visible' ]))
          return reply({ status: 'success', verificationId: entry.verificationId })
        }
      }

      try { rrset = await dnsTxtResolver(publisher) } catch (ex) {
        reason = ex.toString()
        if (reason.indexOf('ENODATA') === -1) {
          debug('dnsTxtResolver', underscore.extend({ publisher: publisher, reason: reason }))
        }
        rrset = []
      }
      for (i = 0; i < rrset.length; i++) { rrset[i] = rrset[i].join('') }

      const loser = async (entry, reason) => {
        debug('verify', underscore.extend(info, { reason: reason }))
        await verified(request, reply, runtime, entry, false, backgroundP, reason)
      }

      info = { publisher: publisher }
      data = {}
      for (let entry of entries) {
        info.verificationId = entry.verificationId

        for (j = 0; j < rrset.length; j++) {
          rr = rrset[j]
          if (rr.indexOf(prefix2) !== 0) continue

          matchP = true
          if (rr.substring(prefix2.length) !== entry.token) {
            await loser(entry, 'TXT RR suffix mismatch ' + prefix2 + entry.token)
            continue
          }

          return verified(request, reply, runtime, entry, true, backgroundP, 'TXT RR matches')
        }
        if (!matchP) {
          if (typeof matchP === 'undefined') await loser(entry, 'no TXT RRs starting with ' + prefix2)
          matchP = false
        }

        for (j = 0; j < hintsK.length; j++) {
          hint = hintsK[j]
          if (typeof data[hint] === 'undefined') {
            try { data[hint] = (await webResolver(debug, runtime, publisher, hints[hint])).toString() } catch (ex) {
              data[hint] = ''
              await loser(entry, ex.toString())
              continue
            }
            debug('verify', 'fetched data for ' + hint)
          }

          if (data[hint].indexOf(entry.token) !== -1) {
            switch (hint) {
              case root:
                pattern = '<meta[^>]*?name=["\']+' + prefix1 + '["\']+content=["\']+' + entry.token + '["\']+.*?>|' +
                        '<meta[^>]*?content=["\']+' + entry.token + '["\']+name=["\']+' + prefix1 + '["\']+.*?>'
                if (!data[hint].match(pattern)) continue
                break

              default:
                break
            }
            return verified(request, reply, runtime, entry, true, backgroundP, hint + ' web file matches')
          }
          debug('verify', 'no match for ' + hint)

          if (i === 0) break
        }
      }

      return reply({ status: 'failure' })
    }
  },

  description: 'Verifies a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { backgroundP: Joi.boolean().optional().default(false).description('running in the background') }
  },

  response: {
    schema: Joi.object().keys({
      status: Joi.string().valid('success', 'failure').required().description('victory is mine!'),
      verificationId: Joi.string().guid().optional().description('identity of the verified requestor')
    })
  }
}

const publish = async (debug, runtime, method, publisher, endpoint, payload) => {
  let result

  try {
    result = await braveHapi.wreck[method](runtime.config.publishers.url + '/api/publishers/' + encodeURIComponent(publisher) +
                                           endpoint,
      {
        headers: {
          authorization: 'Bearer ' + runtime.config.publishers.access_token,
          'content-type': 'application/json'
        },
        payload: JSON.stringify(payload),
        useProxyP: true
      })
    if (Buffer.isBuffer(result)) try { result = JSON.parse(result) } catch (ex) { result = result.toString() }
    debug('publishers', { method: method, publisher: publisher, endpoint: endpoint, reason: result })
  } catch (ex) {
    debug('publishers', { method: method, publisher: publisher, endpoint: endpoint, reason: ex.toString() })
  }

  return result
}

const notify = async (debug, runtime, publisher, payload) => {
  let message = await publish(debug, runtime, 'post', publisher, '/notifications', payload)

  if (!message) return

  message = underscore.extend({ publisher: publisher }, payload)
  debug('notify', message)
  runtime.notify(debug, { channel: '#publishers-bot', text: 'publishers notified: ' + JSON.stringify(message) })
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/publishers').config(v1.bulk),
  braveHapi.routes.async().post().path('/v2/publishers/settlement/{hash}').config(v2.settlement),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/balance').whitelist().config(v2.getBalance),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.getWallet),
  braveHapi.routes.async().put().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.putWallet),
  braveHapi.routes.async().path('/v1/publishers/statement').whitelist().config(v1.getStatements),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/statement').whitelist().config(v1.getStatement),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verifications/{verificationId}').whitelist().config(v1.getToken),
  braveHapi.routes.async().patch().path('/v2/publishers/{publisher}').whitelist().config(v2.patchPublisher),
  braveHapi.routes.async().delete().path('/v1/publishers/{publisher}').whitelist().config(v1.deletePublisher),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verify').config(v1.verifyToken)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('publishers', debug),
      name: 'publishers',
      property: 'publisher',
      empty: {
        publisher: '',
        verified: false,
        authorized: false,
        authority: '',

     // v1 only
     // address: '',
     // legalFormURL: '',

     // v2 and later
        visible: false,
        provider: '',
        altcurrency: '',
        parameters: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { publisher: 1 } ],
      others: [ { verified: 1 }, { authorized: 1 }, { authority: 1 },
                { visible: 1 }, { provider: 1 }, { altcurrency: 1 },
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
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,

        fees: bson.Decimal128.POSITIVE_ZERO,
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { settlementId: 1, publisher: 1 }, { hash: 1, publisher: 1 } ],
      others: [ { address: 1 }, { altcurrency: 1 }, { probi: 1 }, { fees: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('tokens', debug),
      name: 'tokens',
      property: 'verificationId_1_publisher',
      empty: {
        verificationId: '',
        publisher: '',
        token: '',
        verified: false,

     // v2 and later
        visible: false,

        reason: '',
        timestamp: bson.Timestamp.ZERO },
      unique: [ { verificationId: 1, publisher: 1 } ],
      others: [ { token: 1 }, { verified: 1 },
                { visible: 1 },
                { reason: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('publishers-bulk-create')
  await runtime.queue.create('publisher-report')
  await runtime.queue.create('report-publishers-statements')
}
