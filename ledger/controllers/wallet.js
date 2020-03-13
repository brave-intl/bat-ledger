const BigNumber = require('bignumber.js')
const Joi = require('@hapi/joi')
const boom = require('boom')
const bson = require('bson')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

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
   GET /v2/wallet/{paymentId}/info
 */
v2.readInfo = {
  handler: (runtime) => {
    return async (request, h) => {
      const debug = braveHapi.debug(module, request)
      const wallets = runtime.database.get('wallets', debug)
      const paymentId = request.params.paymentId.toLowerCase()

      const wallet = await wallets.findOne({ paymentId: paymentId })
      if (!wallet) {
        throw boom.notFound('no such wallet: ' + paymentId)
      }

      const infoKeys = ['addresses', 'altcurrency', 'provider', 'providerId', 'paymentId', 'httpSigningPubKey', 'anonymousAddress']
      return underscore.pick(wallet, infoKeys)
    }
  },
  description: 'Returns information about the wallet associated with the user',
  tags: ['api'],

  validate: {
    params: Joi.object().keys({
      paymentId: Joi.string().guid().required().description('identity of the wallet')
    }).unknown(true)
  },

  response: {
    schema: Joi.object().keys({
      altcurrency: Joi.string().optional().description('the wallet balance currency'),
      addresses: Joi.object().keys({
        BTC: braveJoi.string().altcurrencyAddress('BTC').optional().description('BTC address'),
        BAT: braveJoi.string().altcurrencyAddress('BAT').optional().description('BAT address'),
        CARD_ID: Joi.string().guid().optional().description('Card id'),
        ETH: braveJoi.string().altcurrencyAddress('ETH').optional().description('ETH address'),
        LTC: braveJoi.string().altcurrencyAddress('LTC').optional().description('LTC address')
      })
    }).unknown(true)
  }
}

v2.read = {
  handler: goneHandler
}

v2.write = {
  handler: goneHandler
}

/*
   GET /v2/wallet
 */
v2.lookup = {
  handler: (runtime) => {
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
  tags: ['api'],

  validate: {
    query: Joi.object().keys({
      publicKey: Joi.string().hex().optional().description('the publickey of the wallet to lookup')
    }).unknown(true)
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
  tags: ['api'],

  validate: {
    params: Joi.object().keys({
      from: Joi.date().iso().required().description('the date to query for'),
      until: Joi.date().iso().optional().description('the non inclusive date to query until')
    }).unknown(true)
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

      const values = await wallets.aggregate([{
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

const grantsTypeEnumValidator = Joi.string().allow('ugp', 'ads').description('grant types')
const paymentIdValidator = Joi.string().guid().required().description('identity of the wallet')
const amountBatValidator = braveJoi.string().numeric().description('an amount, in bat')
v1.walletGrantsInfo = {
  handler: goneHandler,
  description: 'Returns information about the wallet\'s grants',
  tags: ['api'],

  validate: {
    params: Joi.object().keys({
      paymentId: paymentIdValidator,
      type: grantsTypeEnumValidator
    }).unknown(true)
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
  handler: goneHandler
}

function goneHandler () {
  return () => {
    throw boom.resourceGone()
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v2/wallet/{paymentId}/grants/{type}').config(v1.walletGrantsInfo),
  braveHapi.routes.async().path('/v2/wallet/stats/{from}/{until?}').whitelist().config(v2.getStats),
  braveHapi.routes.async().post().path('/v2/wallet/{paymentId}/claim').config(v2.claimWallet),
  braveHapi.routes.async().path('/v2/wallet/{paymentId}/info').config(v2.readInfo),
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
      unique: [{ paymentId: 1 }],
      others: [{ provider: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 }, { httpSigningPubKey: 1 },
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
      unique: [{ providerLinkingId: 1 }],
      others: [{ paymentIds: 1 }]
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
      unique: [{ viewingId: 1 }, { uId: 1 }],
      others: [{ altcurrency: 1 }, { probi: 1 }, { count: 1 }, { timestamp: 1 }]
    }
  ])
}
