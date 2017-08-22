const crypto = require('crypto')
const dns = require('dns')

const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}

const prefix1 = 'brave-ledger-verification='
const prefix2 = prefix1 + '='

let altcurrency

/*
   POST /v1/publishers/settlement/{hash}
*/

v1.settlement = {
  handler: (runtime) => {
    return async (request, reply) => {
      var entry, i, state
      var hash = request.params.hash
      var payload = request.payload
      var debug = braveHapi.debug(module, request)
      var settlements = runtime.database.get('settlements', debug)

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { hash: hash }
      }
      for (i = 0; i < payload.length; i++) {
        entry = payload[i]

        entry.altcurrency = 'BTC'
        entry.probi = entry.satoshis
        underscore.extend(state.$set, underscore.pick(entry, [ 'address', 'altcurrency', 'probi', 'fees' ]))
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
    params: { hash: Joi.string().hex().required().description('transaction hash') },
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      address: braveJoi.string().base58().required().description('BTC address'),
      satoshis: Joi.number().integer().min(1).required().description('the settlement in satoshis'),
      transactionId: Joi.string().guid().description('the transactionId')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   POST /v2/publishers/settlement/{hash}
 */

v2.settlement = {
  handler: (runtime) => {
    return async (request, reply) => {
      const hash = request.params.hash
      const payload = request.payload
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      let entry, i, state, validity

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { hash: hash }
      }
      for (i = 0; i < payload.length; i++) {
        entry = payload[i]
        if (entry.altcurrency !== altcurrency) return reply(boom.badData('altcurrency should be ' + altcurrency))

        validity = Joi.validate(entry.address, braveJoi.string().altcurrencyAddress(entry.altcurrency))
        if (validity.error) return reply(boom.badData(entry.address + ': ' + validity.error))

        underscore.extend(state.$set, underscore.pick(entry, [ 'address', 'altcurrency', 'probi', 'fees' ]))
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
    params: { hash: Joi.string().hex().required().description('transaction hash') },
    payload: Joi.array().min(1).items(Joi.object().keys({
      publisher: braveJoi.string().publisher().required().description('the publisher identity'),
      address: Joi.string().required().description('altcurrency address'),
      altcurrency: braveJoi.string().altcurrencyCode().required().description('the altcurrency'),
      probi: Joi.number().integer().min(1).required().description('the settlement in probi'),
      transactionId: Joi.string().guid().description('the transactionId')
    }).unknown(true)).required().description('publisher settlement report')
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   GET /v1/publishers/{publisher}/balance
 */

v1.getBalance = {
  handler: (runtime) => {
    return async (request, reply) => {
      var amount, probi, summary
      var publisher = request.params.publisher
      var currency = request.query.currency
      var debug = braveHapi.debug(module, request)
      var settlements = runtime.database.get('settlements', debug)
      var voting = runtime.database.get('voting', debug)

      summary = await voting.aggregate([
        {
          $match:
          {
            probi: { $gt: 0 },
            publisher: { $eq: publisher },
            altcurrency: { $eq: 'BTC' },
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
      probi = summary.length > 0 ? summary[0].probi : 0

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
      if (summary.length > 0) probi -= summary[0].probi
      if (probi < 0) probi = 0

      amount = runtime.currency.alt2fiat('BTC', probi, currency) || 0
      reply({ amount: amount, currency: currency, satoshis: probi })
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
      amount: Joi.number().min(0).optional().description('the balance in the fiat currency'),
      currency: braveJoi.string().currencyCode().optional().default('USD').description('the fiat currency'),
      satoshis: Joi.number().integer().min(0).optional().description('the balance in satoshis')
    })
  }
}

/*
   GET /v2/publishers/{publisher}/balance
 */

v2.getBalance = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const currency = request.query.currency.toUpperCase()
      const debug = braveHapi.debug(module, request)
      const settlements = runtime.database.get('settlements', debug)
      const voting = runtime.database.get('voting', debug)
      let amount, probi, summary

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
      probi = summary.length > 0 ? summary[0].probi : 0

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
      if (summary.length > 0) probi -= summary[0].probi
      if (probi < 0) probi = 0

      amount = runtime.currency.alt2fiat(altcurrency, probi, currency) || 0
      reply({ amount: amount, currency: currency, altcurrency: altcurrency, probi: probi })
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
      probi: Joi.number().integer().min(0).optional().description('the balance in probi')
    })
  }
}

/*
   GET /v1/publishers/{publisher}/status
 */

v1.getStatus = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let entry

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      reply(underscore.pick(entry, [ 'authorized', 'provider', 'address', 'altcurrency' ]))
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Gets the status for a verified publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { access_token: Joi.string().guid().optional() }
  },

  response: {
    schema: Joi.object().keys({
      authorized: Joi.boolean().optional().description('authorized for settlements'),
      provider: Joi.string().hostname().optional().description('wallet provider'),
      address: Joi.string().optional().description('altcurrency address'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().default('BAT').description('the altcurrency')
    }).unknown(true).description('the publisher status')
  }
}

/*
   GET /v1/publishers/{publisher}/verifications/{verificationId}
 */

v1.getToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const verificationId = request.params.verificationId
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
      await tokens.update({ verificationId: verificationId, publisher: publisher }, state, { upsert: true })

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
    query: { access_token: Joi.string().guid().optional() }
  },

  response:
    { schema: Joi.object().keys({ token: Joi.string().hex().length(64).required().description('verification token') }) }
}

/*
   PUT /v1/publishers/{publisher}/wallet
 */

v1.setWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      var entry, state
      var publisher = request.params.publisher
      var bitcoinAddress = request.payload.bitcoinAddress
      var verificationId = request.payload.verificationId
      var debug = braveHapi.debug(module, request)
      var publishers = runtime.database.get('publishers', debug)
      var tokens = runtime.database.get('tokens', debug)

      entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      if (!entry.verified) return reply(boom.badData('not verified: ' + publisher + ' using ' + verificationId))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { provider: 'bitgo', address: bitcoinAddress, altcurrency: 'BTC' }
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Sets the bitcoin address for a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { access_token: Joi.string().guid().optional() },
    payload: {
      address: braveJoi.string().base58().required().description('BTC address'),
      verificationId: Joi.string().guid().required().description('identity of the requestor')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   PUT /v2/publishers/{publisher}/wallet
 */

v2.setWallet = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const parameters = request.payload.parameters
      const provider = request.payload.provider
      const verificationId = request.payload.verificationId
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let entry, state

      entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      if (!entry.verified) return reply(boom.badData('not verified: ' + publisher + ' using ' + verificationId))

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { provider: provider, parameters: parameters }
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

// TODO: fetch ETH address

      reply({})
    }
  },

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Sets the wallet provider for a publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    query: { access_token: Joi.string().guid().optional() },
    payload: {
      verificationId: Joi.string().guid().required().description('identity of the requestor'),
      provider: Joi.string().hostname().required().description('wallet provider'),
      parameters: Joi.object().required().description('wallet parameters')
    }
  },

  response:
    { schema: Joi.object().length(0) }
}

/*
   PATCH /v1/publishers/{publisher}
 */

v1.patchPublisher = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const payload = request.payload
      const authorized = payload.authorized
      const legalFormURL = payload.legalFormURL
      const reason = payload.reason
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let authority, entry, state

      if ((legalFormURL) && (legalFormURL.indexOf('void:') === 0) && (legalFormURL !== 'void:form_retry')) {
        return reply(boom.badData('invalid legalFormURL: ' + legalFormURL))
      }

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(payload, { authority: authority })
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })

      if (authorized) await notify(debug, runtime, publisher, { type: 'payments_activated' })
      if ((legalFormURL) && (legalFormURL.indexOf('void:') === 0)) {
        await publish(debug, runtime, 'patch', publisher, '/legal_form', { brave_status: 'void' })

      // void:form_retry
        await notify(debug, runtime, publisher,
                   underscore.extend({ type: legalFormURL.substr(5) },
                                     (reason && reason) ? { params: { message: reason } } : {}))
      }

      reply({})
    }
  },

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Sets the approved legal form and authorizes the publisher',
  tags: [ 'api' ],

  validate: {
    params: { publisher: braveJoi.string().publisher().required().description('the publisher identity') },
    payload: {
      authorized: Joi.boolean().optional().default(false).description('authorize the publisher'),
      legalFormURL: braveJoi.string().uri({ scheme: [ /https?/, 'void' ] }).optional().description('S3 URL'),
      reason: Joi.string().trim().optional().description('explanation for notification')
    }
  },

  response:
    { schema: Joi.object().length(0) }
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
      const debug = braveHapi.debug(module, request)
      const publishers = runtime.database.get('publishers', debug)
      let authority, entry, state

      entry = await publishers.findOne({ publisher: publisher })
      if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

      authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
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

  await runtime.queue.send(debug, 'publisher-report', { publisher: entry.publisher, verified: verified })
  reply({ status: 'success', verificationId: entry.verificationId })
}

v1.verifyToken = {
  handler: (runtime) => {
    return async (request, reply) => {
      const publisher = request.params.publisher
      const backgroundP = request.query.backgroundP
      const debug = braveHapi.debug(module, request)
      const tokens = runtime.database.get('tokens', debug)
      let data, entry, entries, hint, i, info, j, matchP, pattern, reason, rr, rrset

      entries = await tokens.find({ publisher: publisher })
      if (entries.length === 0) return reply(boom.notFound('no such publisher: ' + publisher))

      for (i = 0; i < entries.length; i++) {
        entry = entries[i]
        if (entry.verified) {
          await runtime.queue.send(debug, 'publisher-report', { publisher: entry.publisher, verified: entry.verified })
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

      const loser = async (reason) => {
        debug('verify', underscore.extend(info, { reason: reason }))
        await verified(request, reply, runtime, entry, false, backgroundP, reason)
      }

      info = { publisher: publisher }
      data = {}
      for (i = 0; i < entries.length; i++) {
        entry = entries[i]
        info.verificationId = entry.verificationId

        for (j = 0; j < rrset.length; j++) {
          rr = rrset[j]
          if (rr.indexOf(prefix2) !== 0) continue

          matchP = true
          if (rr.substring(prefix2.length) !== entry.token) {
            await loser('TXT RR suffix mismatch ' + prefix2 + entry.token)
            continue
          }

          return verified(request, reply, runtime, entry, true, backgroundP, 'TXT RR matches')
        }
        if (!matchP) {
          if (typeof matchP === 'undefined') await loser('no TXT RRs starting with ' + prefix2)
          matchP = false
        }

        for (j = 0; j < hintsK.length; j++) {
          hint = hintsK[j]
          if (typeof data[hint] === 'undefined') {
            try { data[hint] = (await webResolver(debug, runtime, publisher, hints[hint])).toString() } catch (ex) {
              data[hint] = ''
              await loser(ex.toString())
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
  let message, result

  try {
    result = await braveHapi.wreck[method](runtime.config.publishers.url + '/api/publishers/' + encodeURIComponent(publisher) +
                                        endpoint,
      { headers: { authorization: 'Bearer ' + runtime.config.publishers.access_token,
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

  return message
}

const notify = async (debug, runtime, publisher, payload) => {
  let message = await publish(debug, runtime, 'post', publisher, '/notifications', payload)

  if (!message) return

  message = underscore.extend({ publisher: publisher }, payload)
  debug('notify', message)
  runtime.notify(debug, { channel: '#publishers-bot', text: 'publishers notified: ' + JSON.stringify(message) })
}

module.exports.routes = [
/*
  braveHapi.routes.async().post().path('/v1/publishers/settlement/{hash}').config(v1.settlement),
*/
  braveHapi.routes.async().post().path('/v2/publishers/settlement/{hash}').config(v2.settlement),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/balance').whitelist().config(v1.getBalance),
  braveHapi.routes.async().path('/v2/publishers/{publisher}/balance').whitelist().config(v2.getBalance),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/status').whitelist().config(v1.getStatus),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verifications/{verificationId}').whitelist().config(v1.getToken),
  braveHapi.routes.async().put().path('/v1/publishers/{publisher}/wallet').whitelist().config(v1.setWallet),
  braveHapi.routes.async().put().path('/v2/publishers/{publisher}/wallet').whitelist().config(v2.setWallet),
  braveHapi.routes.async().path('/v1/publishers/{publisher}/verify').config(v1.verifyToken),
/*
  braveHapi.routes.async().patch().path('/v1/publishers/{publisher}').whitelist().config(v1.patchPublisher),
 */
  braveHapi.routes.async().patch().path('/v2/publishers/{publisher}').whitelist().config(v2.patchPublisher),
  braveHapi.routes.async().delete().path('/v1/publishers/{publisher}').whitelist().config(v1.deletePublisher)
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
        address: '',
        authorized: false,
        authority: '',

     // v1 only
     // legalFormURL: '',

     // v2 and later
        provider: '',
        altcurrency: '',
        parameters: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { publisher: 1 } ],
      others: [ { verified: 1 }, { address: 1 }, { authorized: 1 }, { authority: 1 },
                { provider: 1 }, { altcurrency: 1 },
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
        probi: 1,

        fees: 1,
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { settlementId: 1, publisher: 1 }, { hash: 1, publisher: 1 } ],
      others: [ { address: 1 }, { altcurrency: 1 }, { probi: 1 }, { fees: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('tokens', debug),
      name: 'tokens',
      property: 'verificationId_1_publisher',
      empty: { verificationId: '', publisher: '', token: '', verified: false, reason: '', timestamp: bson.Timestamp.ZERO },
      unique: [ { verificationId: 1, publisher: 1 } ],
      others: [ { token: 1 }, { verified: 1 }, { reason: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('publisher-report')
  await runtime.queue.create('publishers-contributions-prorata')
}
