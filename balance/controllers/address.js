const Joi = require('@hapi/joi')
const boom = require('boom')
const underscore = require('underscore')
const SDebug = require('sdebug')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const checkRedisSize = createRedisSizeChecker(1000 * 60 * 10)

const plugins = {
  rateLimit: {
    enabled: true,
    rate: () => ({
      limit: 60000,
      window: 60
    })
  }
}

const expireIn = process.env.BALANCE_CACHE_TTL_S || 60 // 1 minute default
const expireSettings = {
  EX: expireIn
}

const debug = new SDebug('balance')
const v2 = {}

const cacheConfig = {
  link: 'ledgerBalance:walletByCardId',
  card: 'ledgerBalance:cardInfo',
  wallet: 'ledgerBalance:walletInfo'
}

module.exports.configuration = {
  cache: cacheConfig
}

/*
   GET /v2/wallet/{paymentId}/balance
 */

v2.walletBalance =
{ handler: (runtime) => {
  checkRedisSize(runtime.cache)
  return async (request, h) => {
    const paymentId = request.params.paymentId
    let fresh = false
    const { wallet, link } = cacheConfig

    let walletInfo = await runtime.cache.get(paymentId, wallet)
    if (walletInfo) {
      walletInfo = JSON.parse(walletInfo)
    } else {
      try {
        const headers = {}
        if (process.env.LEDGER_TOKEN) {
          headers['Authorization'] = 'Bearer ' + process.env.LEDGER_TOKEN
        }
        const url = `${runtime.config.ledger.url}/v2/wallet/${paymentId}?refresh=true`
        debug('GET', url)
        walletInfo = await braveHapi.wreck.get(url, {
          headers,
          useProxyP: true
        })
        if (Buffer.isBuffer(walletInfo)) walletInfo = JSON.parse(walletInfo)
      } catch (ex) {
        throw boom.boomify(ex)
      }
      fresh = true
    }

    if (fresh) {
      setTimeout(() => {
        let cardId = accessCardId(walletInfo)
        runtime.cache.set(cardId, paymentId, {}, link)
        runtime.cache.set(paymentId, JSON.stringify(walletInfo), expireSettings, wallet)
      })
    }
    return underscore.pick(walletInfo, ['altcurrency', 'probi', 'cardBalance', 'balance', 'unconfirmed', 'rates', 'parameters', 'grants'])
  }
},

description: 'Get the balance of a ledger wallet',
tags: [ 'api' ],

validate: {
  params: Joi.object().keys({
    paymentId: Joi.string().guid().required().description('identity of the wallet')
  }).unknown(true)
},

response: {
  schema: Joi.object().keys({
    altcurrency: Joi.string().required().description('the wallet currency'),
    balance: Joi.number().min(0).required().description('the (confirmed) wallet balance'),
    cardBalance: braveJoi.string().numeric().required().description('the wallet balance in probi'),
    unconfirmed: Joi.number().min(0).required().description('the unconfirmed wallet balance'),
    rates: Joi.object().optional().description('current exchange rates to various currencies'),
    probi: braveJoi.string().numeric().required().description('the wallet balance in probi'),
    parameters: Joi.object().keys().unknown(true).optional().description('global wallet parameters'),
    grants: Joi.array().optional().items(Joi.object().keys({
      type: Joi.string().allow('ugp', 'ads').default('ugp').description('the type of grant to use'),
      probi: braveJoi.string().numeric().optional().description('the grant value in probi'),
      altcurrency: Joi.string().optional().description('the grant currency'),
      expiryTime: Joi.number().optional().description('unix timestamp when the grant expires')
    }))
  })
}
}

/*
   DELETE /v2/wallet/{paymentId}/balance
 */

v2.invalidateWalletBalance =
{ handler: (runtime) => {
  return async (request, h) => {
    const paymentId = request.params.paymentId

    await runtime.cache.del(paymentId, cacheConfig.wallet)

    return {}
  }
},
auth: {
  strategy: 'simple-scoped-token',
  scope: ['global'],
  mode: 'required'
},

description: 'Invalidate the cached balance of a ledger wallet',
tags: [ 'api' ],

validate: {
  params: Joi.object().keys({
    paymentId: Joi.string().guid().required().description('identity of the wallet')
  }).unknown(true)
},

response: { schema: Joi.object().length(0) }
}

/*
   POST /v2/card
 */

v2.invalidateCardBalance =
{ handler: (runtime) => {
  return async (request, h) => {
    const hapiPayload = request.payload
    const upholdPayload = hapiPayload.payload
    const cardId = upholdPayload.id
    const { cache } = runtime

    const { link, wallet } = cacheConfig

    debug(`accessing cardId: ${cardId}`)
    const paymentId = await cache.get(cardId, link)

    if (paymentId) {
      debug(`removing paymentId: ${paymentId}`)
      await cache.del(paymentId, wallet)
    }

    return {}
  }
},
plugins,
description: 'Invalidate the cached balance of a ledger wallet',
tags: [ 'api' ],

validate: {
  payload: Joi.object({
    payload: Joi.object().keys({
      id: Joi.string().guid().required().description('identity of the card')
    }).unknown(true)
  }).unknown(true)
},

response: { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v2/wallet/{paymentId}/balance').config(v2.walletBalance),
  braveHapi.routes.async().delete().path('/v2/wallet/{paymentId}/balance').config(v2.invalidateWalletBalance),
  braveHapi.routes.async().post().path('/v2/card').config(v2.invalidateCardBalance)
]

module.exports.accessCardId = accessCardId

function accessCardId (wallet) {
  return wallet && wallet.addresses && wallet.addresses.CARD_ID
}

function createRedisSizeChecker (flushDelay) {
  let shouldContinue = true
  let firstDetectedFull = null
  let id = null
  return check

  function stop () {
    clearTimeout(id)
    shouldContinue = false
  }

  async function check (redis) {
    if (id) {
      return stop
    }
    try {
      const now = new Date()
      const percentFull = await howFull(redis)
      if (percentFull > 90) {
        if (!firstDetectedFull) {
          firstDetectedFull = now
        } else if (+firstDetectedFull + flushDelay < +now) {
          firstDetectedFull = null
          clear(redis)
        }
      } else {
        firstDetectedFull = null
      }
    } catch (e) {
      console.error(e)
    }
    if (shouldContinue) {
      const delay = 60000
      id = setTimeout(() => {
        id = null
        check(redis)
      }, delay - (+(new Date()) % delay))
    }
    return stop
  }

  async function howFull (redis) {
    const results = await redis.cache.multi([
      ['info']
    ]).execAsync()
    const resultLines = results[0].split(/\s+/igm)
    let maxmemory
    let usedMemory
    for (let i = 0; i < resultLines.length; i += 1) {
      const line = resultLines[i]
      let split
      split = line.split('maxmemory:')
      if (split.length > 1) {
        maxmemory = +split[1] || Infinity
      }
      split = line.split('used_memory:')
      if (split.length > 1) {
        usedMemory = +split[1]
      }
    }
    return (usedMemory / maxmemory) * 100
  }

  async function clear (redis) {
    await redis.cache.multi([
      ['flushall']
    ]).execAsync()
  }
}
