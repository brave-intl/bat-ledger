const BigNumber = require('bignumber.js')
const Joi = require('joi')
const anonize = require('node-anonize2-relic')
const boom = require('boom')
const bson = require('bson')
const timestamp = require('monotonic-timestamp')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}

/*
   GET /v1/wallet/{paymentId}
   GET /v2/wallet/{paymentId}
 */

const read = function (runtime, apiVersion) {
  return async (request, reply) => {
    const amount = request.query.amount
    const balanceP = request.query.balance
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const refreshP = request.query.refresh
    const wallets = runtime.database.get('wallets', debug)
    const altcurrency = request.query.altcurrency

    let currency = request.query.currency
    let balances, result, state, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    if (altcurrency && altcurrency !== wallet.altcurrency) {
      return reply(boom.badData('the altcurrency of the transaction must match that of the wallet'))
    }

    result = {
      altcurrency: wallet.altcurrency,
      paymentStamp: wallet.paymentStamp || 0,
      rates: currency ? underscore.pick(runtime.currency.rates[wallet.altcurrency], [ currency.toUpperCase() ]) : runtime.currency.rates[wallet.altcurrency]
    }

    if (apiVersion === 2) {
      result = underscore.extend(result, { addresses: wallet.addresses })
    }

    if ((refreshP) || (balanceP && !wallet.balances)) {
      balances = await runtime.wallet.balances(wallet)

      if (!underscore.isEqual(balances, wallet.balances)) {
        state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: balances } }
        await wallets.update({ paymentId: paymentId }, state, { upsert: true })

        await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: paymentId }, state.$set))
      }
    } else {
      balances = wallet.balances
    }
    if (balances) {
      underscore.extend(result, {
        probi: balances.confirmed.toString(),
        balance: new BigNumber(balances.confirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4),
        unconfirmed: new BigNumber(balances.unconfirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4)
      })
    }

    if (amount) {
      if (refreshP) {
        if (currency) {
          if (!runtime.currency.fiats[currency]) {
            return reply(boom.notFound('no such currency: ' + currency))
          }
          if (!runtime.currency.rates[wallet.altcurrency] || !runtime.currency.rates[wallet.altcurrency][currency.toUpperCase()]) {
            const errMsg = `There is not yet a conversion rate for ${wallet.altcurrency} to ${currency.toUpperCase()}`
            const resp = boom.serverUnavailable(errMsg)
            resp.output.headers['retry-after'] = '5'
            return reply(resp)
          }
        } else if (altcurrency) {
          currency = altcurrency
        } else {
          return reply(boom.badData('must pass at least one of currency or altcurrency'))
        }
        result = underscore.extend(result, await runtime.wallet.unsignedTx(wallet, amount, currency, balances.confirmed))

        if (result.unsignedTx) {
          if (result.requestType === 'bitcoinMultisig') {
            state = {
              $currentDate: { timestamp: { $type: 'timestamp' } },
              $set: { unsignedTx: result.unsignedTx.transactionHex }
            }
          } else {
            state = {
              $currentDate: { timestamp: { $type: 'timestamp' } },
              $set: { unsignedTx: result.unsignedTx }
            }
          }
          await wallets.update({ paymentId: paymentId }, state, { upsert: true })
        }
      }
    }

    if (apiVersion === 1) {
      result = underscore.omit(underscore.extend(result, { satoshis: Number(result.probi) }), ['altcurrency', 'probi', 'requestType'])
    }

    reply(result)
  }
}

v1.read = { handler: (runtime) => { return read(runtime, 1) },
  description: 'Returns information about the BTC wallet associated with the user',
  tags: [ 'api' ],

  validate: {
    params: {
      paymentId: Joi.string().guid().required().description('identity of the wallet')
    },
    query: {
      amount: Joi.number().positive().optional().description('the payment amount in the fiat currency'),
      balance: Joi.boolean().optional().default(false).description('return balance information'),
      currency: braveJoi.string().currencyCode().optional().description('the fiat currency'),
      refresh: Joi.boolean().optional().default(false).description('return balance and transaction information')
    }
  },

  response: {
    schema: Joi.object().keys({
      balance: Joi.number().min(0).optional().description('the (confirmed) wallet balance in BTC'),
      unconfirmed: Joi.number().min(0).optional().description('the unconfirmed wallet balance in BTC'),
      buyURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for an initial payment'),
      recurringURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for recurring payments'),
      paymentStamp: Joi.number().min(0).required().description('timestamp of the last successful payment'),
      rates: Joi.object().optional().description('current exchange rates from BTC to various currencies'),
      satoshis: Joi.number().integer().min(0).optional().description('the wallet balance in satoshis'),
      unsignedTx: Joi.object().optional().description('unsigned transaction')
    })
  }
}

v2.read = { handler: (runtime) => { return read(runtime, 2) },
  description: 'Returns information about the wallet associated with the user',
  tags: [ 'api' ],

  validate: {
    params: {
      paymentId: Joi.string().guid().required().description('identity of the wallet')
    },
    query: {
      // FIXME since this amount is not in native probi - need some kind of sig fig limit
      amount: Joi.number().positive().optional().description('the payment amount in fiat currency if provied, otherwise the altcurrency'),
      balance: Joi.boolean().optional().default(false).description('return balance information'),
      currency: braveJoi.string().currencyCode().optional().description('the fiat currency'),
      altcurrency: braveJoi.string().altcurrencyCode().optional().description('the altcurrency of the requested transaction'),
      refresh: Joi.boolean().optional().default(false).description('return balance and transaction information')
    }
  },

  response: {
    schema: Joi.object().keys({
      balance: Joi.number().min(0).optional().description('the (confirmed) wallet balance'),
      unconfirmed: Joi.number().min(0).optional().description('the unconfirmed wallet balance'),
      paymentStamp: Joi.number().min(0).required().description('timestamp of the last successful payment'),
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      probi: braveJoi.string().numeric().optional().description('the wallet balance in probi'),
      altcurrency: Joi.string().optional().description('the wallet balance currency'),
      requestType: Joi.string().valid('httpSignature', 'bitcoinMultisig').optional().description('the type of the request'),
      unsignedTx: Joi.object().optional().description('unsigned transaction'),
      addresses: Joi.object().keys({
        BTC: braveJoi.string().altcurrencyAddress('BTC').optional().description('BTC address'),
        BAT: braveJoi.string().altcurrencyAddress('BAT').optional().description('BAT address'),
        CARD_ID: Joi.string().guid().optional().description('Card id'),
        ETH: braveJoi.string().altcurrencyAddress('ETH').optional().description('ETH address'),
        LTC: braveJoi.string().altcurrencyAddress('LTC').optional().description('LTC address')
      })
    })
  }
}

/*
   PUT /v1/wallet/{paymentId}
   PUT /v2/wallet/{paymentId}
 */

const write = function (runtime, apiVersion) {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const signedTx = request.payload.signedTx
    const surveyorId = request.payload.surveyorId
    const viewingId = request.payload.viewingId
    const requestType = request.payload.requestType
    const surveyors = runtime.database.get('surveyors', debug)
    const viewings = runtime.database.get('viewings', debug)
    const wallets = runtime.database.get('wallets', debug)
    let fee, now, params, result, state, surveyor, surveyorIds, votes, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))
    if (!wallet.unsignedTx) throw new Error('no unsignedTx found')

    try {
      const info = underscore.extend(wallet, { requestType: requestType })
      runtime.wallet.validateTxSignature(info, wallet.unsignedTx, signedTx)
    } catch (ex) {
      debug('validateTxSignature', { reason: ex.toString(), stack: ex.stack })
      runtime.captureException(ex, { req: request, extra: { paymentId: paymentId } })
      return reply(boom.badData(ex.toString()))
    }

    surveyor = await surveyors.findOne({ surveyorId: surveyorId })
    if (!surveyor) return reply(boom.notFound('no such surveyor: ' + surveyorId))

    if (!surveyor.surveyors) surveyor.surveyors = []

    params = surveyor.payload.adFree

    votes = runtime.wallet.getTxProbi(wallet, wallet.unsignedTx).dividedBy(params.probi).times(params.votes).round().toNumber()

    if (votes < 1) votes = 1

    if (votes > surveyor.surveyors.length) {
      state = { payload: request.payload, result: result, votes: votes, message: 'insufficient surveyors' }
      debug('wallet', state)

      const errMsg = 'surveyor ' + surveyor.surveyorId + ' has ' + surveyor.surveyors.length + ' surveyors, but needed ' + votes
      runtime.captureException(errMsg, { req: request })

      const resp = boom.serverUnavailable(errMsg)
      resp.output.headers['retry-after'] = '5'
      return reply(resp)
    }

    result = await runtime.wallet.submitTx(wallet, wallet.unsignedTx, signedTx)

    // FIXME double check uphold statuses
    if (result.status !== 'accepted' && result.status !== 'pending' && result.status !== 'completed') return reply(boom.badData(result.status))

    now = timestamp()
    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { paymentStamp: now } }
    await wallets.update({ paymentId: paymentId }, state, { upsert: true })

    fee = result.fee

    surveyorIds = underscore.shuffle(surveyor.surveyors).slice(0, votes)
    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: {
        surveyorId: surveyorId,
        uId: anonize.uId(viewingId),
        surveyorIds: surveyorIds,
        altcurrency: wallet.altcurrency,
        probi: result.probi,
        count: votes
      }
    }
    await viewings.update({ viewingId: viewingId }, state, { upsert: true })

    var picked = ['votes', 'probi', 'altcurrency']
    // BTC only
    if (result.hash) {
      picked.push('hash')
    }
    result = underscore.extend({ paymentStamp: now }, underscore.pick(result, picked))
    if (apiVersion === 1) {
      reply(underscore.omit(underscore.extend(result, {satoshis: Number(result.probi)}), ['probi', 'altcurrency']))
    } else {
      reply(result)
    }

    await runtime.queue.send(debug, 'contribution-report', underscore.extend({
      paymentId: paymentId,
      address: wallet.addresses[result.altcurrency],
      surveyorId: surveyorId,
      viewingId: viewingId,
      fee: fee,
      votes: votes
    }, result))
  }
}

v1.write = { handler: (runtime) => { return write(runtime, 1) },
  description: 'Makes a contribution using the BTC wallet associated with the user',
  tags: [ 'api' ],

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },
    payload: {
      viewingId: Joi.string().guid().required().description('unique-identifier for voting'),
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      signedTx: Joi.string().hex().required().description('signed transaction')
    }
  },

  response: {
    schema: Joi.object().keys({
      paymentStamp: Joi.number().min(0).required().description('timestamp of the last successful contribution'),
      satoshis: Joi.number().integer().min(0).optional().description('the contribution amount in satoshis'),
      votes: Joi.number().integer().min(0).optional().description('the corresponding number of publisher votes'),
      hash: Joi.string().hex().required().description('transaction hash')
    })
  }
}

v2.write = { handler: (runtime) => { return write(runtime, 2) },
  description: 'Makes a contribution using the wallet associated with the user',
  tags: [ 'api' ],

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },
    payload: {
      viewingId: Joi.string().guid().required().description('unique-identifier for voting'),
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      requestType: Joi.string().valid('httpSignature', 'bitcoinMultisig').required().description('the type of the request'),
      signedTx: Joi.required().description('signed transaction')
    }
  },

  response: {
    schema: Joi.object().keys({
      paymentStamp: Joi.number().min(0).required().description('timestamp of the last successful contribution'),
      probi: braveJoi.string().numeric().description('the contribution amount in probi'),
      altcurrency: Joi.string().optional().description('the wallet balance currency'),
      votes: Joi.number().integer().min(0).optional().description('the corresponding number of publisher votes'),
      hash: Joi.string().hex().optional().description('transaction hash')
    })
  }
}

/*
   GET /v2/wallet
 */
v2.lookup = { handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)
    const publicKey = request.query.publicKey
    const wallet = await wallets.findOne({ httpSigningPubKey: publicKey })
    if (!wallet) return reply(boom.notFound('no such wallet with publicKey: ' + publicKey))
    reply({ paymentId: wallet.paymentId })
  }
},
  description: 'Lookup a wallet',
  tags: [ 'api' ],

  validate: {
    query: {
      publicKey: Joi.string().hex().optional().description('the publickey of the wallet to lookup')
    }
  },

  response: {
    schema: Joi.object().keys({
      paymentId: Joi.string().guid().required().description('identity of the requested wallet')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/wallet/{paymentId}').config(v1.read),
  braveHapi.routes.async().path('/v2/wallet/{paymentId}').config(v2.read),
  braveHapi.routes.async().put().path('/v1/wallet/{paymentId}').config(v1.write),
  braveHapi.routes.async().put().path('/v2/wallet/{paymentId}').config(v2.write),
  braveHapi.routes.async().path('/v2/wallet').config(v2.lookup)
]

module.exports.initialize = async (debug, runtime) => {
  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('wallets', debug),
      name: 'wallets',
      property: 'paymentId',
      empty: {
        paymentId: '',
        // v1
        // address: '',
        provider: '',
        balances: {},
        // v1
        // keychains: {},
        paymentStamp: 0,

     // v2 and later
        altcurrency: '',
        addresses: {},
        httpSigningPubKey: '',
        providerId: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { paymentId: 1 } ],
      others: [ { provider: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 }, { httpSigningPubKey: 1 } ]
    },
    {
      category: runtime.database.get('viewings', debug),
      name: 'viewings',
      property: 'viewingId',
      empty: {
        viewingId: '',
        uId: '',
     // v1 only
     // satoshis: 0,

     // v2 and later
        altcurrency: '',
        probi: '0',

        count: 0,
        surveyorIds: [],
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { viewingId: 1 }, { uId: 1 } ],
      others: [ { altcurrency: 1 }, { probi: 1 }, { count: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('contribution-report')
  await runtime.queue.create('wallet-report')
}
