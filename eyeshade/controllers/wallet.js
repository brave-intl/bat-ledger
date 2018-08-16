const boom = require('boom')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}

/*
   GET /v1/wallet/{paymentId}
 */

v1.get =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const paymentId = request.params.paymentId.toLowerCase()
    const wallets = runtime.database.get('wallets', debug)
    let wallet

    wallet = await wallets.findOne({ paymentId: paymentId })
    if (!wallet) return reply(boom.notFound('no such wallet: ' + paymentId))

    reply(underscore.omit(wallet, [ '_id' ]))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },

  description: 'Retrieves information about a paymentID',
  tags: [ 'api' ],

  validate: {
    params: {
      paymentId: Joi.string().guid().required().description('identity of the wallet')
    }
  },

  response: {
    schema: Joi.object().keys({}).unknown(true)
  }
}

/*
 GET /v1/wallet/stats
*/
v1.getStats = {
  handler: (runtime) => async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const contributions = runtime.database.get('contributions', debug)
    const controlContributions = matcher({
      cohort: 'control'
    })
    const $matchContributions = {
      $match: {
        $or: [
          controlContributions
        ]
      }
    }
    const $projectPaymentId = {
      $project: {
        _id: 0,
        paymentId: '$paymentId',
        identifier: {
          timestamp: {
            $dateToString: {
              format: '%Y-%m-%d', date: '$_id'
            }
          }
        }
      }
    }
    const $addedToSet = {
      $group: {
        _id: '$identifier.timestamp',
        funded: {
          // flatten any payment id
          // contributed to twice in the same day
          $addToSet: '$paymentId'
        }
      }
    }
    const $finalProject = {
      $project: {
        // count the number of paymentId's
        // in the funded array
        funded: count('control'),
        created: '$_id',
        _id: 0
      }
    }

    const result = await contributions.aggregate([
      $matchContributions,
      $projectPaymentId,
      $addedToSet,
      $finalProject
    ])

    reply(result)

    function count (cohort) {
      return {
        $sum: {
          $cond: {
            if: {
              cohort
            },
            then: 1,
            else: 0
          }
        }
      }
    }
    function matcher (query) {
      return underscore.assign({
        probi: {
          $gt: 0
        },
        paymentId: {
          $nin: [null, '']
        }
      }, query)
    }
  },
  auth: {
    strategy: 'session',
    scope: [ 'ledger', 'QA' ],
    mode: 'required'
  },
  description: 'Retrieves information about funded wallets',
  tags: [ 'api' ],
  response: {
    schema: Joi.array().items(
      Joi.object().keys({
        created: Joi.string(),
        funded: Joi.number()
      })
    )
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/wallet/stats').whitelist().config(v1.getStats),
  braveHapi.routes.async().path('/v1/wallet/{paymentId}').whitelist().config(v1.get)
]
