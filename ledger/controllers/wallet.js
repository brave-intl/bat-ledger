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
const braveUtils = utils.extras.utils

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
    let balances, info, result, state, wallet, wallet2

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
      if (runtime.registrars.persona) {
        result = underscore.extend(result, { parameters: runtime.registrars.persona.payload || {} })
      }
    }

    if ((refreshP) || (balanceP && !wallet.balances)) {
      balances = await runtime.wallet.balances(wallet)

      if (!underscore.isEqual(balances, wallet.balances)) {
        state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { balances: balances } }
        await wallets.update({ paymentId: paymentId }, state, { upsert: true })

        await runtime.queue.send(debug, 'wallet-report', underscore.extend({ paymentId: paymentId }, state.$set))
        state = null
      }
    } else {
      balances = wallet.balances
    }
    if (balances) {
      let { grants } = wallet
      if (grants) {
        let [total, results] = await sumActiveGrants(runtime, null, wallet, grants)
        balances.confirmed = new BigNumber(balances.confirmed).plus(total)
        result.grants = results
      }

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
        }
      }

      info = await runtime.wallet.purchaseBAT(wallet, amount, currency, request.headers['accept-language'])
      wallet2 = info && info.extend && underscore.extend({}, info.extend, wallet)
      if ((wallet2) && (!underscore.isEqual(wallet, wallet2))) {
        if (!state) {
          state = {
            $currentDate: { timestamp: { $type: 'timestamp' } },
            $set: {}
          }
        }
        underscore.extend(state.$set, info.quotes)
      }
      underscore.extend(result, underscore.omit(info, [ 'quotes' ]))

      if (state) await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    }
    if (apiVersion === 1) {
      result = underscore.omit(underscore.extend(result, { satoshis: Number(result.probi) }), ['altcurrency', 'probi', 'requestType'])
    }

    reply(result)
  }
}

async function sumActiveGrants (runtime, info, wallet, grants) {
  let total = new BigNumber(0)
  const results = []
  for (let grant of grants) {
    let { token, status } = grant
    if (status !== 'active') {
      continue
    }
    if (await runtime.wallet.isGrantExpired(info, grant)) {
      await runtime.wallet.expireGrant(info, wallet, grant)
    } else {
      let content = braveUtils.extractJws(token)
      total = total.plus(content.probi)
      results.push(underscore.pick(content, ['altcurrency', 'expiryTime', 'probi']))
    }
  }
  return [total, results]
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
    }).unknown(true)
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
      }),
      grants: Joi.array().optional().items(Joi.object().keys({
        probi: braveJoi.string().numeric().optional().description('the grant value in probi'),
        altcurrency: Joi.string().optional().description('the grant currency'),
        expiryTime: Joi.number().optional().description('unix timestamp when the grant expires')
      }))
    }).unknown(true)
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
    let cohort, fee, now, params, result, state, surveyor, surveyorIds, votes, wallet

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

    surveyor = await surveyors.findOne({ surveyorId: surveyorId, surveyorType: 'contribution' })
    if (!surveyor) return reply(boom.notFound('no such surveyor: ' + surveyorId))
    if (!surveyor.active) return reply(boom.resourceGone('cannot perform a contribution with an inactive surveyor'))

    if (!surveyor.cohorts) {
      if (surveyor.surveyors) { // legacy surveyor, no cohort support
        return reply(boom.resourceGone('cannot perform a contribution using a legacy surveyor'))
      } else {
        // new contribution surveyor not yet populated with voting surveyors
        const errMsg = 'surveyor ' + surveyor.surveyorId + ' has 0 surveyors, but needed ' + votes
        runtime.captureException(errMsg, { req: request })

        const resp = boom.serverUnavailable(errMsg)
        resp.output.headers['retry-after'] = '5'
        return reply(resp)
      }
    }

    params = surveyor.payload.adFree

    votes = runtime.wallet.getTxProbi(wallet, wallet.unsignedTx).dividedBy(params.probi).times(params.votes).round().toNumber()

    if (votes < 1) votes = 1

    const possibleCohorts = ['control', 'grant']

    for (let cohort of possibleCohorts) {
      const cohortSurveyors = surveyor.cohorts[cohort]

      if (votes > cohortSurveyors.length) {
        state = { payload: request.payload, result: result, votes: votes, message: 'insufficient surveyors' }
        debug('wallet', state)

        const errMsg = 'surveyor ' + surveyor.surveyorId + ' has ' + cohortSurveyors.length + ' ' + cohort + ' surveyors, but needed ' + votes
        runtime.captureException(errMsg, { req: request })

        const resp = boom.serverUnavailable(errMsg)
        resp.output.headers['retry-after'] = '5'
        return reply(resp)
      }
    }

    try {
      result = await runtime.wallet.redeem(wallet, wallet.unsignedTx, signedTx, request)
    } catch (err) {
      let payload = err.data.payload
      payload = payload.toString()
      if (payload[0] === '{') {
        payload = JSON.parse(payload)
        let payloadData = payload.data
        if (payloadData) {
          await markGrantsAsRedeemed(payloadData.redeemedIDs)
        }
      }
      return reply(err)
    }

    if (!result) {
      result = await runtime.wallet.submitTx(wallet, wallet.unsignedTx, signedTx)
    }

    if (result.status !== 'accepted' && result.status !== 'pending' && result.status !== 'completed') return reply(boom.badData(result.status))

    cohort = 'control'

    const grantIds = result.grantIds
    if (grantIds) {
      cohort = wallet.cohort || 'grant'
      await markGrantsAsRedeemed(grantIds)
      result = underscore.omit(result, ['grantIds'])
    }

    now = timestamp()
    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { paymentStamp: now } }
    await wallets.update({ paymentId: paymentId }, state, { upsert: true })

    fee = result.fee

    surveyorIds = underscore.shuffle(surveyor.cohorts[cohort]).slice(0, votes)

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

    const picked = ['votes', 'probi', 'altcurrency']
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
      votes: votes,
      cohort: cohort
    }, result))

    async function markGrantsAsRedeemed (grantIds) {
      await Promise.all(grantIds.map((grantId) => {
        const data = {
          $set: { 'grants.$.status': 'completed' }
        }
        const query = {
          paymentId,
          'grants.grantId': grantId
        }
        return wallets.update(query, data)
      }))
      await runtime.queue.send(debug, 'redeem-report', {
        grantIds,
        redeemed: true
      })
    }
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

/*
   GET /v1/wallet/stats
 */

v1.getStats =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)

    let values = await wallets.aggregate([{
      $match: {
        paymentId: {
          $nin: ['', null]
        }
      }
    }, {
      $project: {
        _id: 0,
        balance: '$balances.balance',
        created: {
          $dateToString: { format: '%Y-%m-%d', date: '$_id' }
        },
        selfFunded: {
          $cond: {
            if: {
              $gt: [
                '$paymentStamp',
                0
              ]
            },
            then: 1,
            else: 0
          }
        },
        virtual: {
          $cond: {
            if: {
              $size: {
                $ifNull: ['$grants', []]
              }
            },
            then: 1,
            else: 0
          }
        },
        funded: {
          $cond: {
            if: {
              $ne: ['$balances.confirmed', '0']
            },
            then: 1,
            else: 0
          }
        }
      }
    }, {
      $group: {
        _id: '$created',
        // unable to sum / convert strings
        balance: {
          $push: '$balance'
        },
        virtual: {
          $sum: {
            $cond: {
              if: '$virtual',
              then: 1,
              else: 0
            }
          }
        },
        selfFunded: {
          $sum: '$selfFunded'
        },
        funded: {
          $sum: '$funded'
        },
        wallets: {
          $sum: 1
        }
      }
    }, {
      $project: {
        created: '$_id',
        wallets: 1,
        selfFunded: 1,
        balance: 1,
        virtual: 1,
        funded: 1,
        _id: 0
      }
    }])

    values = values.map(({
      selfFunded,
      created,
      balance,
      wallets,
      virtual,
      funded
    }) => ({
      selfFunded,
      balance: add(balance),
      created,
      wallets,
      virtual,
      funded
    }))

    reply(values)

    function add (numbers) {
      return numbers.reduce((memo, number) => {
        return memo.plus(new BigNumber(number || 0))
      }, new BigNumber('0')).toNumber()
    }
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Retrieves information about wallets',
  tags: [ 'api' ],

  response: {
    schema: Joi.array().items(
      Joi.object().keys({
        selfFunded: Joi.number().required().description('the number of wallets created on this date that have been self funded'),
        created: Joi.string().required().description('date the wallets in this cohort were created'),
        balance: Joi.number().required().description('the balances of the wallets created on this day'),
        wallets: Joi.number().required().description('the number of wallets created on this date'),
        virtual: Joi.number().required().description('the number of wallets created on this date that have a claimed grant that has not yet been redeemed'),
        funded: Joi.number().required().description('the number of wallets that are currently funded')
      })
    )
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/wallet/{paymentId}').config(v1.read),
  braveHapi.routes.async().path('/v2/wallet/{paymentId}').config(v2.read),
  braveHapi.routes.async().put().path('/v1/wallet/{paymentId}').config(v1.write),
  braveHapi.routes.async().put().path('/v2/wallet/{paymentId}').config(v2.write),
  braveHapi.routes.async().path('/v2/wallet').config(v2.lookup),
  braveHapi.routes.async().path('/v1/wallet/stats').whitelist().config(v1.getStats)
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

        timestamp: bson.Timestamp.ZERO,
        grants: []
      },
      unique: [ { paymentId: 1 } ],
      others: [ { provider: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 }, { httpSigningPubKey: 1 },
        { providerId: 1, 'grants.promotionId': 1 }
      ]
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
