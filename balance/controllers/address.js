const BigNumber = require('bignumber.js')
const Joi = require('joi')
const UpholdSDK = require('@uphold/uphold-sdk-javascript')
const boom = require('boom')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v2 = {}

/*
   GET /v2/card/BAT/{cardId}/balance
 */

v2.balance =
{ handler: (runtime) => {
  return async (request, reply) => {
    const altcurrency = 'BAT'
    const cardId = request.params.cardId
    let fresh = false
    let expireIn = 60 // 1 minute

    let cardInfo = await runtime.cache.get(cardId, 'ledgerBalance:cardInfo')
    if (cardInfo) {
      cardInfo = JSON.parse(cardInfo)
    } else {
      try {
        cardInfo = await runtime.wallet.uphold.getCard(cardId)
      } catch (ex) {
        if (ex instanceof UpholdSDK.NotFoundError) {
          return reply(boom.notFound('no such cardId: ' + cardId))
        }
        throw ex
      }
      fresh = true
    }

    const balanceProbi = new BigNumber(cardInfo.balance).times(runtime.currency.alt2scale(altcurrency))
    const spendableProbi = new BigNumber(cardInfo.available).times(runtime.currency.alt2scale(altcurrency))

    const balances = {
      probi: spendableProbi.toString(),
      balance: spendableProbi.dividedBy(runtime.currency.alt2scale(altcurrency)).toFixed(4),
      unconfirmed: balanceProbi.minus(spendableProbi).dividedBy(runtime.currency.alt2scale(altcurrency)).toFixed(4)
    }

    reply(balances)

    if (fresh) {
      runtime.cache.set(cardId, JSON.stringify(cardInfo), { EX: expireIn }, 'ledgerBalance:cardInfo')
    }
  }
},

  description: 'Get the balance of a BAT card',
  tags: [ 'api' ],

  validate: {
    params: {
      cardId: Joi.string().guid().required().description('identity of the card')
    }
  },

  response: {
    schema: Joi.object().keys({
      balance: Joi.number().min(0).required().description('the (confirmed) wallet balance'),
      unconfirmed: Joi.number().min(0).required().description('the unconfirmed wallet balance'),
      rates: Joi.object().optional().description('current exchange rates to various currencies'),
      probi: braveJoi.string().numeric().required().description('the wallet balance in probi')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v2/card/BAT/{cardId}/balance').config(v2.balance)
]
