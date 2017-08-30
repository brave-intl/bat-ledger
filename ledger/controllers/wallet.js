const anonize = require('node-anonize2-relic')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const timestamp = require('monotonic-timestamp')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}

/*
   GET /v1/wallet/{paymentId}
 */

v1.read =
{ handler: (runtime) => {
  return async (request, reply) => {
    const amount = request.query.amount
    const balanceP = request.query.balance
    const currency = request.query.currency
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const refreshP = request.query.refresh
    const wallets = runtime.database.get('wallets', debug)
    let balances, result, state, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    result = {
      paymentStamp: wallet.paymentStamp || 0,
      rates: currency ? underscore.pick(runtime.wallet.rates, [ currency.toUpperCase() ]) : runtime.wallet.rates
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
        altcurrency: wallet.altcurrency,
        probi: balances.confirmed,
        balance: (balances.confirmed / runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4),
        unconfirmed: (balances.unconfirmed / runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4)
      })
    }

    if ((amount) && (currency)) {
      underscore.extend(result, runtime.wallet.purchaseBTC(wallet, amount, currency))
      underscore.extend(result, runtime.wallet.recurringBTC(wallet, amount, currency))
      if (refreshP) {
        if (!runtime.currency.fiats[currency]) {
          return reply(boom.notFound('no such currency: ' + currency))
        }
        result.unsignedTx = await runtime.wallet.unsignedTx(wallet, amount, currency, balances.confirmed)

        if (result.unsignedTx) {
          state = {
            $currentDate: { timestamp: { $type: 'timestamp' } },
            $set: { unsignedTx: result.unsignedTx.transactionHex }
          }
          await wallets.update({ paymentId: paymentId }, state, { upsert: true })
        }
      }
    }

    result = underscore.omit(underscore.extend(result, { satoshis: result.probi }), ['altcurrency', 'probi'])
    reply(result)
  }
},

  description: 'Returns information about the BTC wallet associated with the user',
  tags: [ 'api' ],

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },
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

/*
   PUT /v1/wallet/{paymentId}
 */

v1.write =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const signedTx = request.payload.signedTx
    const surveyorId = request.payload.surveyorId
    const viewingId = request.payload.viewingId
    const surveyors = runtime.database.get('surveyors', debug)
    const viewings = runtime.database.get('viewings', debug)
    const wallets = runtime.database.get('wallets', debug)
    let fee, now, params, result, state, surveyor, surveyorIds, votes, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    try {
      if (wallet.unsignedTx) {
        if (!runtime.wallet.compareTx(wallet.unsignedTx, signedTx)) {
          runtime.notify(debug, { channel: '#ledger-bot', text: 'comparison check failed on paymentId ' + paymentId })
        }
      } else {
        runtime.notify(debug, { channel: '#ledger-bot', text: 'unable to perform comparison check for paymentId ' + paymentId })
      }
    } catch (ex) {
      debug('compareTx', ex)
      runtime.notify(debug, { channel: '#ledger-bot', text: 'comparison error on paymentId ' + paymentId })
    }

    surveyor = await surveyors.findOne({ surveyorId: surveyorId })
    if (!surveyor) return reply(boom.notFound('no such surveyor: ' + surveyorId))

    if (!surveyor.surveyors) surveyor.surveyors = []

    params = surveyor.payload.adFree

    votes = Math.round(((runtime.wallet.getTxAmount(signedTx)) / params.probi) * params.votes)

    if (votes < 1) votes = 1

    if (votes > surveyor.surveyors.length) {
      state = { payload: request.payload, result: result, votes: votes, message: 'insufficient surveyors' }
      debug('wallet', state)
      const errMsg = 'surveyor ' + surveyor.surveyorId + ' has ' + surveyor.surveyors.length + ' surveyors, but needed ' + votes
      runtime.notify(debug, {
        channel: '#devops-bot',
        text: errMsg
      })
      const resp = boom.serverUnavailable(errMsg)
      resp.output.headers['retry-after'] = '5'
      return reply(resp)
    }

    result = await runtime.wallet.submitTx(wallet, signedTx)
/*
    { status   : 'accepted'
    , tx       : '...'
    , hash     : '...'
    , instant  : false,
    , fee      : 7969
    , address  : '...'
    , satoshis : 868886
    }
}
 */

    if (result.status !== 'accepted') return reply(boom.badData(result.status))

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

    // v1 only
    result = { paymentStamp: now, satoshis: result.probi, votes: votes, hash: result.hash }
    reply(result)

    result = { paymentStamp: now, altcurrency: result.altcurrency, probi: result.probi, votes: votes, hash: result.hash }
    await runtime.queue.send(debug, 'contribution-report', underscore.extend({
      paymentId: paymentId,
      address: wallet.address,
      surveyorId: surveyorId,
      viewingId: viewingId,
      fee: fee
    }, result))
  }
},

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

/*
   PUT /v1/wallet/{paymentId}/recover
   GET /v2/wallet/{paymentId}/recover
 */

v1.recover =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const passphrase = request.payload.passPhrase
    const recoveryId = request.payload.recoveryId
    const wallets = runtime.database.get('wallets', debug)
    let original, satoshis, wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    original = await wallets.findOne({ paymentId: recoveryId })
    if (!original) return reply(boom.notFound('no such wallet: ' + recoveryId))

    satoshis = await runtime.wallet.recover(wallet, original, passphrase)

    reply({ satoshis: satoshis })
  }
},

  description: 'Recover the balance of an earlier wallet',
  tags: [ 'api', 'deprecated' ],

  validate: {
    params: { paymentId: Joi.string().guid().required().description('identity of the wallet') },
    payload: {
      recoveryId: Joi.string().guid().required().description('identity of the wallet to be recovered'),
      passPhrase: Joi.string().required().description('the passphrase for the wallet to be recovered')
    }
  },

  response: {
    schema: Joi.object().keys({
      satoshis: Joi.number().integer().min(0).optional().description('the recovered amount in satoshis')
    })
  }

}

v2.recover =
{ handler: (runtime) => {
  return async (request, reply) => {
    let balances, result, state, wallet
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const wallets = runtime.database.get('wallets', debug)

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    balances = await runtime.wallet.balances(wallet)
    if (!underscore.isEqual(balances, wallet.balances)) {
      state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: balances } }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })

      await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: paymentId }, state.$set))
    }

    result = underscore.extend({
      address: wallet.address,
      keychains: { user: underscore.pick(wallet.keychains.user, [ 'xpub', 'encryptedXprv', 'path' ]) },
      satoshis: balances.confirmed
    })

    reply(result)
  }
},

  description: 'Recover the balance of an earlier wallet',
  tags: [ 'api' ],

  validate:
    { params: { paymentId: Joi.string().guid().required().description('identity of the wallet') } },

  response: {
    schema: Joi.object().keys({
      address: braveJoi.string().base58().required().description('BTC address'),
      keychains: Joi.object().keys({
        user: Joi.object().keys({
          xpub: braveJoi.string().Xpub().required(),
          encryptedXprv: Joi.string().required(),
          path: Joi.string().required()
        }).required()
      }).required(),
      satoshis: Joi.number().integer().min(0).optional().description('the recovered amount in satoshis')
    }).required()
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/wallet/{paymentId}').config(v1.read),
  braveHapi.routes.async().put().path('/v1/wallet/{paymentId}').config(v1.write),
  braveHapi.routes.async().put().path('/v1/wallet/{paymentId}/recover').config(v1.recover),
  braveHapi.routes.async().path('/v2/wallet/{paymentId}/recover').config(v2.recover)
]

module.exports.initialize = async (debug, runtime) => {
  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('wallets', debug),
      name: 'wallets',
      property: 'paymentId',
      empty: {
        paymentId: '',
        address: '',
        provider: '',
        balances: {},
        keychains: {},
        paymentStamp: 0,

     // v2 and later
        altcurrency: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { paymentId: 1 } ],
      others: [ { provider: 1 }, { address: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 } ]
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
        probi: 0,

        count: 0,
        surveyorIds: [],
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { viewingId: 1 }, { uId: 1 } ],
      others: [ { altcurrency: 1 }, { probi: 1 }, { count: 1 }, { timestamp: 1 } ]
    }
  ])

  await convertDB(debug, runtime)
  await runtime.queue.create('contribution-report')
  await runtime.queue.create('wallet-report')
}

// TEMPORARY
const convertDB = async (debug, runtime) => {
  const wallets = runtime.database.get('wallets', debug)
  const viewings = runtime.database.get('viewings', debug)
  let entries

  entries = await wallets.find({ altcurrency: { $exists: false } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC' }
    }

    await wallets.update({ paymentId: entry.paymentId }, state, { upsert: true })
  })

  entries = await viewings.find({ satoshis: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC', probi: entry.satoshis },
      $unset: { satoshis: '' }
    }

    await viewings.update({ surveyorId: entry.surveyorId }, state, { upsert: true })
  })
}
