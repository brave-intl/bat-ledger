const BigNumber = require('bignumber.js')
const uuidV5 = require('uuid/v5')
const Joi = require('@hapi/joi')
const anonize = require('node-anonize2-relic')
const boom = require('boom')
const bson = require('bson')
const timestamp = require('monotonic-timestamp')
const underscore = require('underscore')

const surveyorsLib = require('../lib/surveyor')
const {
  createComposite,
  promotionIdExclusions,
  promotionIdBonuses
} = require('../lib/wallet')
const {
  getCohort
} = require('../lib/grants')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const braveUtils = utils.extras.utils

const defaultTipChoices = (process.env.DEFAULT_TIP_CHOICES && process.env.DEFAULT_TIP_CHOICES.split(',')) || [1, 5, 10]
const defaultMonthlyChoices = (process.env.DEFAULT_MONTHLY_CHOICES && process.env.DEFAULT_MONTHLY_CHOICES.split(',')) || [1, 5, 10]

const v1 = {}
const v2 = {}

const walletStatsList = Joi.array().items(
  Joi.object().keys({
    created: Joi.string().required().description('date the wallets in this cohort were created'),
    wallets: Joi.number().required().description('the number of wallets created on this date'),
    contributed: Joi.number().required().description('the number of wallets created on this date that have a claimed grant that has not yet been redeemed'),
    walletProviderBalance: Joi.string().required().description('the balances of the wallets created on this day'),
    anyFunds: Joi.number().required().description('the number of wallets created on this date that have either an unredeemed grant or a wallet provider balance'),
    activeGrant: Joi.number().required().description('the number of wallets created on this date that have an active grant'),
    walletProviderFunded: Joi.number().required().description('the number of wallets that are currently funded')
  })
)

/*
   GET /v2/wallet/{paymentId}
 */

const read = function (runtime, apiVersion) {
  return async (request, h) => {
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
    if (!wallet) {
      throw boom.notFound('no such wallet: ' + paymentId)
    }

    if (altcurrency && altcurrency !== wallet.altcurrency) {
      throw boom.badData('the altcurrency of the transaction must match that of the wallet')
    }

    const subset = currency ? [currency.toUpperCase()] : null
    const rates = await runtime.currency.rates(wallet.altcurrency, subset)
    result = {
      altcurrency: wallet.altcurrency,
      paymentStamp: wallet.paymentStamp || 0,
      httpSigningPubKey: wallet.httpSigningPubKey,
      rates: underscore.mapObject(rates, (value) => +value)
    }

    result = underscore.extend(result, { addresses: wallet.addresses })
    if (runtime.registrars.persona) {
      const { payload } = runtime.registrars.persona
      underscore.extend(payload, { defaultTipChoices, defaultMonthlyChoices })
      result = underscore.extend(result, { parameters: payload || {} })
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
      balances.cardBalance = balances.confirmed

      if (runtime.config.forward.grants) {
        const { grants: grantsConfig } = runtime.config.wreck
        const payload = await braveHapi.wreck.get(grantsConfig.baseUrl + '/v1/grants/active?paymentId=' + paymentId, {
          headers: grantsConfig.headers,
          useProxyP: true
        })
        const { grants } = JSON.parse(payload.toString())
        if (grants.length > 0) {
          const total = grants.reduce((total, grant) => {
            return total.plus(grant.probi)
          }, new BigNumber(0))
          balances.confirmed = new BigNumber(balances.confirmed).plus(total)
          result.grants = grants.map((grant) => {
            return underscore.pick(grant, ['altcurrency', 'expiryTime', 'probi', 'type'])
          })
        }
      } else {
        let { grants } = wallet
        if (grants) {
          let [total, results] = await sumActiveGrants(runtime, null, wallet, grants)
          balances.confirmed = new BigNumber(balances.confirmed).plus(total)
          result.grants = results
        }
      }

      underscore.extend(result, {
        balance: new BigNumber(balances.confirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4),
        cardBalance: new BigNumber(balances.cardBalance).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toString(),
        probi: balances.confirmed.toString(),
        unconfirmed: new BigNumber(balances.unconfirmed).dividedBy(runtime.currency.alt2scale(wallet.altcurrency)).toFixed(4)
      })
    }

    if (amount) {
      if (refreshP) {
        if (currency) {
          try {
            await runtime.currency.ratio('USD', currency)
          } catch (e) {
            throw boom.notFound('no such currency: ' + currency)
          }
          const rates = await runtime.currency.rates(wallet.altcurrency)
          if (!rates || !rates[currency.toUpperCase()]) {
            const errMsg = `There is not yet a conversion rate for ${wallet.altcurrency} to ${currency.toUpperCase()}`
            const resp = boom.serverUnavailable(errMsg)
            resp.output.headers['retry-after'] = '5'
            throw resp
          }
        } else if (altcurrency) {
          currency = altcurrency
        } else {
          throw boom.badData('must pass at least one of currency or altcurrency')
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

    return result
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
      const exposedContent = underscore.pick(content, ['altcurrency', 'expiryTime', 'probi'])
      exposedContent.type = grant.type || 'ugp'
      results.push(exposedContent)
    }
  }
  return [total, results]
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
      cardBalance: braveJoi.string().numeric().optional().description('the wallet balance less grants'),
      balance: Joi.number().min(0).optional().description('the (confirmed) wallet balance'),
      unconfirmed: Joi.number().min(0).optional().description('the unconfirmed wallet balance'),
      paymentStamp: Joi.number().min(0).required().description('timestamp of the last successful payment'),
      rates: Joi.object().pattern(/^[A-Z]{2,}$/i, Joi.number()).required().description('current exchange rates to various currencies'),
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
        type: Joi.string().allow(['ugp', 'ads', 'android']).default('ugp').description('the type of grant to use'),
        probi: braveJoi.string().numeric().optional().description('the grant value in probi'),
        altcurrency: Joi.string().optional().description('the grant currency'),
        expiryTime: Joi.number().optional().description('unix timestamp when the grant expires')
      }))
    }).unknown(true)
  }
}

/*
   PUT /v2/wallet/{paymentId}
 */

const write = function (runtime, apiVersion) {
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const signedTx = request.payload.signedTx
    const surveyorId = request.payload.surveyorId
    const viewingId = request.payload.viewingId
    const requestType = request.payload.requestType
    const surveyors = runtime.database.get('surveyors', debug)
    const viewings = runtime.database.get('viewings', debug)
    const wallets = runtime.database.get('wallets', debug)

    let now, params, result, state, surveyor, surveyorIds, wallet, txnProbi, grantCohort
    let totalFee, grantFee, nonGrantFee
    let totalVotes, grantVotes, nonGrantVotes

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) {
      throw boom.notFound('no such wallet: ' + paymentId)
    }

    const txn = JSON.parse(signedTx.octets)

    surveyor = await surveyors.findOne({ surveyorId, surveyorType: 'contribution' })
    if (!surveyor) {
      throw boom.notFound('no such surveyor: ' + surveyorId)
    }
    if (!surveyor.active) {
      throw boom.resourceGone('cannot perform a contribution with an inactive surveyor')
    }

    params = surveyor.payload.adFree
    txnProbi = runtime.wallet.getTxProbi(wallet, txn)
    totalVotes = txnProbi.dividedBy(params.probi).times(params.votes).round().toNumber()

    if (totalVotes < 1) {
      throw boom.rangeNotSatisfiable('Too low vote value for transaction. PaymentId: ' + paymentId)
    }

    const minimum = surveyorsLib.voteValueFromSurveyor(runtime, surveyor, wallet.altcurrency)
    try {
      const info = underscore.extend(wallet, { requestType: requestType })
      runtime.wallet.validateTxSignature(info, signedTx, {
        minimum
      })
    } catch (ex) {
      debug('validateTxSignature', { reason: ex.toString(), stack: ex.stack })
      runtime.captureException(ex, { req: request, extra: { paymentId: paymentId } })
      throw boom.badData(ex.toString())
    }

    if (!surveyor.cohorts) {
      if (surveyor.surveyors) { // legacy surveyor, no cohort support
        throw boom.resourceGone('cannot perform a contribution using a legacy surveyor')
      } else {
        // new contribution surveyor not yet populated with voting surveyors
        const errMsg = 'surveyor ' + surveyor.surveyorId + ' has 0 surveyors, but needed ' + totalVotes
        runtime.captureException(errMsg, { req: request })

        const resp = boom.serverUnavailable(errMsg)
        resp.output.headers['retry-after'] = '5'
        throw resp
      }
    }

    for (let cohort of surveyorsLib.cohorts) {
      const cohortSurveyors = surveyor.cohorts[cohort]
      if (totalVotes > cohortSurveyors.length) {
        state = { payload: request.payload, result: result, votes: totalVotes, message: 'insufficient surveyors' }
        debug('wallet', state)

        const errMsg = 'surveyor ' + surveyor.surveyorId + ' has ' + cohortSurveyors.length + ' ' + cohort + ' surveyors, but needed ' + totalVotes
        runtime.captureException(errMsg, { req: request })

        const resp = boom.serverUnavailable(errMsg)
        resp.output.headers['retry-after'] = '5'
        throw resp
      }
    }

    if (!runtime.config.disable.grants) {
      try {
        if (runtime.config.forward.grants) {
          const infoKeys = [ 'altcurrency', 'provider', 'providerId', 'paymentId' ]
          const redeemPayload = {
            wallet: underscore.extend(underscore.pick(wallet, infoKeys), { publicKey: wallet.httpSigningPubKey }),
            transaction: Buffer.from(JSON.stringify(underscore.pick(signedTx, [ 'headers', 'octets' ]))).toString('base64')
          }
          try {
            const { grants } = runtime.config.wreck
            const payload = await braveHapi.wreck.post(grants.baseUrl + '/v1/grants', {
              headers: grants.headers,
              payload: JSON.stringify(redeemPayload),
              useProxyP: true
            })
            result = JSON.parse(payload.toString())
            result.grantIds = true
          } catch (ex) {
            console.log(ex.data.payload.toString())
            throw ex
          }
        } else {
          result = await runtime.wallet.redeem(wallet, txn, signedTx, request)
        }
      } catch (err) {
        if (!runtime.config.forward.grants) {
          const { data } = err
          if (data) {
            let { payload } = data
            payload = payload.toString()
            if (payload[0] === '{') {
              payload = JSON.parse(payload)
              let payloadData = payload.data
              if (payloadData) {
                await markGrantsAsRedeemed(payloadData.redeemedIDs)
              }
            }
          }
        }
        throw boom.boomify(err)
      }
    }

    if (!result) {
      result = await runtime.wallet.submitTx(wallet, txn, signedTx, {
        commit: true
      })
    }
    totalFee = result.fee

    if (result.status !== 'accepted' && result.status !== 'pending' && result.status !== 'completed') {
      throw boom.badData(result.status)
    }

    const grantIds = result.grantIds
    const grantTotal = result.grantTotal

    if (grantIds) { // some grants were redeemed
      if (!runtime.config.forward.grants) {
        await markGrantsAsRedeemed(grantIds)
        grantCohort = getCohort(wallet.grants, grantIds, Object.keys(surveyor.cohorts))
      } else {
        grantCohort = 'grant'
      }

      let grantVotesAvailable = new BigNumber(grantTotal).dividedBy(params.probi).times(params.votes).round().toNumber()

      if (grantVotesAvailable >= totalVotes) { // more grant value was redeemed than the transaction value, all votes will be grant
        nonGrantVotes = 0
        nonGrantFee = 0
        grantVotes = totalVotes
        grantFee = totalFee
        surveyorIds = surveyor.cohorts[grantCohort].slice(0, grantVotes)
      } else { // some of the transaction value will be covered by grant
        grantVotes = grantVotesAvailable
        nonGrantVotes = totalVotes - grantVotes

        let grantProbiRate = grantTotal / txnProbi
        grantFee = totalFee * grantProbiRate
        nonGrantFee = totalFee - grantFee

        let grantSurveyorIds = surveyor.cohorts[grantCohort].slice(0, grantVotes)
        let nonGrantSurveyorIds = surveyor.cohorts['control'].slice(0, nonGrantVotes)
        surveyorIds = underscore.shuffle(grantSurveyorIds.concat(nonGrantSurveyorIds))
        result = underscore.omit(result, ['grantIds'])
      }
    } else { // no grants were used in the transaction
      grantVotes = 0
      grantFee = 0
      nonGrantVotes = totalVotes
      nonGrantFee = totalFee
      surveyorIds = underscore.shuffle(surveyor.cohorts['control']).slice(0, totalVotes)
    }

    now = timestamp()
    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { paymentStamp: now } }
    await wallets.update({ paymentId: paymentId }, state, { upsert: true })

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: {
        surveyorId: surveyorId,
        uId: anonize.uId(viewingId),
        surveyorIds: surveyorIds,
        altcurrency: wallet.altcurrency,
        probi: result.probi,
        count: totalVotes
      }
    }
    await viewings.update({ viewingId: viewingId }, state, { upsert: true })

    const picked = ['votes', 'probi', 'altcurrency']
    result = underscore.extend({ paymentStamp: now }, underscore.pick(result, picked))

    const response = h.response(result)

    if (grantVotes > 0) {
      await runtime.queue.send(debug, 'contribution-report', underscore.extend({
        paymentId: paymentId,
        address: wallet.addresses[result.altcurrency],
        surveyorId: surveyorId,
        viewingId: viewingId,
        fee: grantFee,
        votes: grantVotes,
        cohort: grantCohort
      }, result))
      countVote(runtime, nonGrantVotes, {
        cohort: grantCohort
      })
    }

    if (nonGrantVotes > 0) {
      const cohort = 'control'
      await runtime.queue.send(debug, 'contribution-report', underscore.extend({
        paymentId: paymentId,
        address: wallet.addresses[result.altcurrency],
        surveyorId: surveyorId,
        viewingId: viewingId,
        fee: nonGrantFee,
        votes: nonGrantVotes,
        cohort
      }, result))
      countVote(runtime, nonGrantVotes, {
        cohort
      })
    }
    return response

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

function countVote (runtime, votes, labels) {
  runtime.prometheus.getMetric('votes_issued_counter').inc(labels, votes)
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
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const wallets = runtime.database.get('wallets', debug)
    const publicKey = request.query.publicKey
    const wallet = await wallets.findOne({ httpSigningPubKey: publicKey })
    if (!wallet) {
      throw boom.notFound('no such wallet with publicKey: ' + publicKey)
    }
    return {
      paymentId: wallet.paymentId
    }
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
   GET /v2/wallet/stats/{from}/{until?}
 */

v2.getStats = {
  handler: getStats(singleDateQuery),

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['global', 'stats'],
    mode: 'required'
  },

  description: 'Retrieves information about wallets',
  tags: [ 'api' ],

  validate: {
    params: {
      from: Joi.date().iso().required().description('the date to query for'),
      until: Joi.date().iso().optional().description('the non inclusive date to query until')
    }
  },
  response: {
    schema: walletStatsList
  }
}

function singleDateQuery ({
  params
}) {
  const {
    from,
    until
  } = params
  const baseDate = new Date(from)
  const DAY = 1000 * 60 * 60 * 24
  const endOfDay = new Date(+baseDate + DAY)
  const dateEnd = until ? new Date(until) : endOfDay
  return {
    _id: {
      $gte: bson.ObjectID.createFromTime(new Date(baseDate / 1000)),
      $lt: bson.ObjectID.createFromTime(new Date(dateEnd / 1000))
    },
    paymentId: {
      $nin: ['', null]
    }
  }
}

function defaultQuery () {
  return {
    paymentId: {
      $nin: ['', null]
    }
  }
}

function getStats (getQuery = defaultQuery) {
  return (runtime) => {
    return async (request, h) => {
      const debug = braveHapi.debug(module, request)
      const wallets = runtime.database.get('wallets', debug)

      let values = await wallets.aggregate([{
        $match: getQuery(request)
      }, {
        $project: {
          _id: 0,
          walletProviderBalance: '$balances.balance',
          created: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$_id'
            }
          },
          contributed: {
            $cond: {
              if: {
                $gt: ['$paymentStamp', 0]
              },
              then: 1,
              else: 0
            }
          },
          activeGrant: {
            $cond: {
              then: 1,
              else: 0,
              if: {
                $size: {
                  $filter: {
                    input: {
                      $ifNull: ['$grants', []]
                    },
                    as: 'grant',
                    cond: {
                      $eq: ['$$grant.status', 'active']
                    }
                  }
                }
              }
            }
          },
          walletProviderFunded: {
            $cond: {
              then: 1,
              else: 0,
              if: {
                $ne: ['$balances.confirmed', '0']
              }
            }
          }
        }
      }, {
        $project: {
          walletProviderBalance: 1,
          created: 1,
          contributed: 1,
          activeGrant: 1,
          walletProviderFunded: 1,
          anyFunds: {
            $cond: {
              then: 1,
              else: 0,
              if: {
                $or: [{
                  $gt: ['$walletProviderBalance', 0]
                }, {
                  $gt: ['$activeGrant', 0]
                }]
              }
            }
          }
        }
      }, {
        $group: {
          _id: '$created',
          walletProviderBalance: {
            $push: '$walletProviderBalance'
          },
          contributed: {
            $sum: '$contributed'
          },
          walletProviderFunded: {
            $sum: '$walletProviderFunded'
          },
          anyFunds: {
            $sum: '$anyFunds'
          },
          activeGrant: {
            $sum: '$activeGrant'
          },
          wallets: {
            $sum: 1
          }
        }
      }, {
        $project: {
          created: '$_id',
          wallets: 1,
          contributed: 1,
          walletProviderBalance: 1,
          anyFunds: 1,
          activeGrant: 1,
          walletProviderFunded: 1,
          _id: 0
        }
      }])

      return values.map(({
        created,
        wallets,
        contributed,
        walletProviderBalance,
        anyFunds,
        activeGrant,
        walletProviderFunded
      }) => ({
        created,
        wallets,
        contributed,
        walletProviderBalance: add(walletProviderBalance),
        anyFunds,
        activeGrant,
        walletProviderFunded
      }))

      function add (numbers) {
        return numbers.reduce((memo, number) => {
          return memo.plus(new BigNumber(number || 0))
        }, new BigNumber('0')).toString()
      }
    }
  }
}

const grantsTypeEnumValidator = Joi.string().allow(['ugp', 'ads']).description('grant types')
const paymentIdValidator = Joi.string().guid().required().description('identity of the wallet')
const amountBatValidator = braveJoi.string().numeric().description('an amount, in bat')
v1.walletGrantsInfo = {
  handler: walletGrantsInfoHandler,
  description: 'Returns information about the wallet\'s grants',
  tags: [ 'api' ],

  validate: {
    params: {
      paymentId: paymentIdValidator,
      type: grantsTypeEnumValidator
    }
  },

  response: {
    schema: Joi.object().keys({
      type: grantsTypeEnumValidator,
      amount: amountBatValidator,
      bonus: amountBatValidator,
      lastClaim: Joi.date().iso().allow(null).description('the last claimed grant')
    })
  }
}

/*
  POST /v2/wallet/{paymentId}/claim
*/

v2.claimWallet = {
  handler: claimWalletHandler,
  description: 'Claim anonymous wallets',
  tags: ['api'],
  validate: {
    payload: Joi.alternatives().try(
      Joi.object().keys({
        signedTx: Joi.required().description('signed transaction')
      }),
      Joi.object().keys({
        signedTx: Joi.required().description('signed transaction'),
        anonymousAddress: Joi.string().guid().description('anonymous address for payouts')
      })
    )
  },
  response: {
    schema: Joi.object().length(0)
  }
}

module.exports.compositeGrants = compositeGrants

module.exports.routes = [
  braveHapi.routes.async().path('/v2/wallet/{paymentId}/grants/{type}').config(v1.walletGrantsInfo),
  braveHapi.routes.async().path('/v2/wallet/stats/{from}/{until?}').whitelist().config(v2.getStats),
  braveHapi.routes.async().post().path('/v2/wallet/{paymentId}/claim').config(v2.claimWallet),
  braveHapi.routes.async().path('/v2/wallet/{paymentId}').config(v2.read),
  braveHapi.routes.async().put().path('/v2/wallet/{paymentId}').config(v2.write),
  braveHapi.routes.async().path('/v2/wallet').config(v2.lookup)
]

module.exports.initialize = async (debug, runtime) => {
  await runtime.database.checkIndices(debug, [
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
        providerLinkingId: '',
        anonymousAddress: '',

        timestamp: bson.Timestamp.ZERO,
        grants: []
      },
      unique: [ { paymentId: 1 } ],
      others: [ { provider: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 }, { httpSigningPubKey: 1 },
        { providerId: 1, 'grants.promotionId': 1 }
      ]
    },
    {
      category: runtime.database.get('members', debug),
      name: 'members',
      property: 'providerLinkingId',
      empty: {
        providerLinkingId: '',
        paymentIds: []
      },
      unique: [ { providerLinkingId: 1 } ],
      others: [ { paymentIds: 1 } ]
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

function claimWalletHandler (runtime) {
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const { params, payload } = request
    const { signedTx, anonymousAddress } = payload
    const { paymentId } = params
    const wallets = runtime.database.get('wallets', debug)
    const members = runtime.database.get('members', debug)

    const wallet = await wallets.findOne({ paymentId })
    if (!wallet) {
      throw boom.notFound()
    }

    const txn = runtime.wallet.validateTxSignature(wallet, signedTx, {
      destinationValidator: braveJoi.string().guid(),
      minimum: 0
    })
    const { postedTx } = await runtime.wallet.submitTx(wallet, txn, signedTx, {
      commit: false
    })
    const {
      type,
      isMember,
      node = { user: { id: '' } }
    } = postedTx.destination
    const userId = node.user.id

    // check that where the transfer is going to is a card, that belongs to a member
    if (type !== 'card' || !isMember || !userId) {
      throw boom.forbidden()
    }
    const providerLinkingId = uuidV5(userId, 'c39b298b-b625-42e9-a463-69c7726e5ddc')
    // if wallet has already been claimed, don't tie wallet to member id
    if (wallet.providerLinkingId) {
      // Check if the member matches the associated member
      if (providerLinkingId !== wallet.providerLinkingId) {
        throw boom.forbidden()
      }

      if (anonymousAddress && (!wallet.anonymousAddress || anonymousAddress !== wallet.anonymousAddress)) {
        // allow for updating / setting the anonymous address even if already claimed
        await wallets.update({
          paymentId
        }, {
          $set: { anonymousAddress }
        })
      }
    } else {
      await members.update({ providerLinkingId }, {
        $set: {
          providerLinkingId
        }
      }, { upsert: true })
      // Attempt to associate the paymentId with the member, enforcing max associations no more than 3
      const member = await members.findOneAndUpdate({
        providerLinkingId,
        $expr: {
          $lt: [{
            $size: {
              $ifNull: ['$paymentIds', []]
            }
          }, 3]
        }
      }, {
        $push: {
          paymentIds: paymentId
        }
      })
      // If association worked, perform reverse association, providerLinkingId with wallet
      if (!member) {
        throw boom.conflict()
      }
      let toSet = { providerLinkingId }

      if (anonymousAddress) {
        underscore.extend(toSet, { anonymousAddress })
      }
      await wallets.update({
        paymentId
      }, {
        $set: toSet
      })
    }

    if (+txn.denomination.amount !== 0) {
      await runtime.wallet.submitTx(wallet, txn, signedTx, {
        commit: true
      })
    }

    return {}
  }
}

function walletGrantsInfoHandlerFWD (runtime) {
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    try {
      let {
        res,
        payload
      } = await compositeGrantsFWD(debug, runtime, request.params)
      const { statusCode } = res
      payload = payload.toString()
      if (statusCode === 204) {
        return h.response({}).code(statusCode)
      }
      payload = JSON.parse(payload)
      if (statusCode === 200) {
        const { earnings, lastClaim, type } = payload
        return {
          lastClaim,
          type,
          amount: earnings
        }
      } else {
        throw boom.boomify(payload)
      }
    } catch (e) {
      throw boom.boomify(e)
    }
  }
}

async function compositeGrantsFWD (debug, runtime, {
  paymentId,
  type
}) {
  return runtime.wreck.grants.get(debug, `/v1/promotions/${type}/grants/summary`, {
    query: {
      paymentId,
      // just here until we swap it out
      // with the key above
      paymentID: paymentId
    }
  })
}

/*
  GET /v2/wallet/{paymentId}/grants/{type}
*/
function walletGrantsInfoHandler (runtime) {
  if (runtime.config.forward.grants) {
    return walletGrantsInfoHandlerFWD(runtime)
  }
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const {
      type,
      paymentId
    } = request.params
    try {
      const composite = await compositeGrants(debug, runtime, {
        type,
        paymentId
      })
      const status = composite.lastClaim ? 200 : 204
      return h.response(composite).code(status)
    } catch (e) {
      throw boom.boomify(e)
    }
  }
}

async function compositeGrants (debug, runtime, {
  paymentId,
  type: requiredType
}) {
  const wallets = runtime.database.get('wallets', debug)
  const wallet = await wallets.findOne({ paymentId }, { grants: 1 })
  if (!wallet) {
    throw boom.notFound('unable to find wallet')
  }
  const { grants = [] } = wallet
  let amount = new BigNumber(0)
  let lastClaim = null
  for (let i = grants.length - 1; i >= 0; i--) {
    const grant = grants[i]
    const { claimTimestamp, token, type } = grant
    if (requiredType === 'ugp') {
      if (type && type !== requiredType) {
        continue
      }
    } else if (type !== requiredType) {
      continue
    }
    const content = braveUtils.extractJws(token)
    const { probi } = content
    const { promotionId } = grant
    if (promotionIdExclusions[promotionId]) {
      continue
    }
    amount = amount.plus(probi)
    // remove bonuses
    const bonus = promotionIdBonuses[promotionId]
    if (bonus) {
      const bigBonus = (new BigNumber(bonus)).times(braveUtils.PROBI_FACTOR)
      amount = amount.minus(bigBonus)
    }
    const claimedAt = new Date(claimTimestamp)
    lastClaim = lastClaim > claimedAt ? lastClaim : claimedAt
  }
  return createComposite({
    type: requiredType,
    amount: amount.dividedBy(braveUtils.PROBI_FACTOR),
    lastClaim
  })
}
