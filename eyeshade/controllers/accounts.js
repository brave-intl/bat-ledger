const Joi = require('joi')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

/*
   GET /v1/accounts/{account}/transactions
*/

v1.getTransactions =
{ handler: (runtime) => {
  return async (request, reply) => {
    const account = request.params.account
    const query1 = `select
  created_at,
  description,
  channel,
  amount,
  settlement_currency,
  settlement_amount,
  settlement_destination_type,
  settlement_destination,
  transaction_type
from account_transactions
where account_id = $1
ORDER BY created_at
`

    const result = await runtime.postgres.pool.query(query1, [ account ])
    const transactions = result.rows

    transactions.forEach((transaction) => {
      Object.keys(transaction).forEach((key) => (transaction[key] == null) && delete transaction[key])
    })

    reply(transactions)
  }
},

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of transactions for use in statement generation, graphical dashboarding and filtering, etc.',
  tags: [ 'api', 'publishers' ],

  validate: {
    params: { account:
      braveJoi.string().owner().required().description('the owner identity')
    }
  },

  response: {
    schema: Joi.array().items(Joi.object().keys({
      created_at: Joi.date().iso().required().description('when the transaction was created'),
      description: Joi.string().required().description('description of the transaction'),
      channel: braveJoi.string().publisher().required().description('channel transaction is for'),
      amount: Joi.number().required().description('amount in BAT'),
      settlement_currency: braveJoi.string().anycurrencyCode().optional().description('the fiat of the settlement'),
      settlement_amount: Joi.number().optional().description('amount in settlement_currency'),
      settlement_destination_type: Joi.string().optional().valid(['uphold']).description('type of address settlement was paid to'),
      settlement_destination: Joi.string().optional().description('destination address of the settlement'),
      transaction_type: Joi.string().valid(['contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual']).required().description('type of the transaction')
    }))
  }
}

/*
   GET /v1/balances
*/

v1.getBalances =
{ handler: (runtime) => {
  return async (request, reply) => {
    let accounts = request.query.account

    if (!Array.isArray(accounts)) {
      accounts = [accounts]
    }

    const query1 = `select * from account_balances where account_id = any($1::text[])`

    const transactions = await runtime.postgres.pool.query(query1, [ accounts ])
    reply(transactions.rows)
  }
},

  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of balances e.g. for an owner and their channels',

  tags: [ 'api', 'publishers' ],

  validate: {
    query: { account: Joi.alternatives().try(
      Joi.string().description('account (channel or owner)'),
      Joi.array().items(Joi.string().required().description('account (channel or owner)'))
    ).required()}
  },

  response: {
    schema: Joi.array().items(
       Joi.object().keys({
         account_id: Joi.string(),
         account_type: Joi.string().valid(['channel', 'owner', 'uphold']),
         balance: Joi.number().description('balance in BAT')
       })
     )
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/accounts/{account}/transactions').whitelist().config(v1.getTransactions),
  braveHapi.routes.async().path('/v1/balances').whitelist().config(v1.getBalances)
]
