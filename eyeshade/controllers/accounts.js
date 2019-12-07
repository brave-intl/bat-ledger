const Joi = require('@hapi/joi')
const { getPublisherProps } = require('bat-publisher')
const boom = require('boom')
const utils = require('bat-utils')
const BigNumber = require('bignumber.js')
const _ = require('underscore')
const extrasUtils = require('bat-utils/lib/extras-utils')
const queries = require('../lib/queries')
const transactions = require('../lib/transaction')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

const settlementDestinationTypes = ['uphold']
const accountTypes = ['channel', 'owner'].concat(settlementDestinationTypes)
const transactionTypes = ['contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual', 'user_deposit', 'manual_settlement']

const stringValidator = Joi.string()
const accountTypeValidation = stringValidator.valid.apply(stringValidator, accountTypes)
const orderParam = Joi.string().valid('asc', 'desc').optional().default('desc').description('order')
const joiChannel = Joi.string().description('The channel that earned or paid the transaction')
const joiBAT = braveJoi.string().numeric()

const selectAccountBalances = `
SELECT *
FROM account_balances
WHERE account_id = any($1::text[]);
`
const selectPendingAccountVotes = `
SELECT
  channel,
  SUM(votes.tally * surveyor.price)::TEXT as balance
FROM votes, (
  SELECT id, price
  FROM surveyor_groups
) surveyor
WHERE
    votes.surveyor_id = surveyor.id
AND votes.channel = any($1::text[])
AND NOT votes.transacted
AND NOT votes.excluded
GROUP BY channel;
`
/*
   GET /v1/accounts/{account}/transactions
*/

v1.getTransactions =
{ handler: (runtime) => {
  return async (request, h) => {
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

    const result = await runtime.postgres.query(query1, [ account ])
    const transactions = result.rows

    return _.map(transactions, (tx) => {
      const omitted = _.omit(tx, (value) => value == null)
      return Object.assign({ channel: '' }, omitted)
    })
  }
},

auth: {
  strategy: 'simple-scoped-token',
  scope: ['publishers'],
  mode: 'required'
},

description: 'Used by publishers for retrieving a list of transactions for use in statement generation, graphical dashboarding and filtering, etc.',
tags: [ 'api', 'publishers' ],

validate: {
  params: Joi.object().keys({
    account: Joi.alternatives().try(
      braveJoi.string().owner(),
      Joi.string().guid()
    ).required().description('the owner identity')
  }).unknown(true)
},

response: {
  schema: Joi.array().items(Joi.object().keys({
    created_at: Joi.date().iso().required().description('when the transaction was created'),
    description: Joi.string().required().description('description of the transaction'),
    channel: Joi.alternatives().try(
      braveJoi.string().publisher().required().description('channel transaction is for'),
      Joi.string().default('').allow('').description('empty string returned')
    ),
    amount: braveJoi.string().numeric().required().description('amount in BAT'),
    settlement_currency: braveJoi.string().anycurrencyCode().optional().description('the fiat of the settlement'),
    settlement_amount: braveJoi.string().numeric().optional().description('amount in settlement_currency'),
    settlement_destination_type: stringValidator.valid.apply(stringValidator, settlementDestinationTypes).optional().description('type of address settlement was paid to'),
    settlement_destination: Joi.string().optional().description('destination address of the settlement'),
    transaction_type: stringValidator.valid.apply(stringValidator, transactionTypes).required().description('type of the transaction')
  }))
}
}

/*
   GET /v1/accounts/balances/{type}/top
*/

v1.getTopBalances =
{ handler: (runtime) => {
  return async (request, h) => {
    let { limit } = request.query
    const { type } = request.params

    const query1 = `SELECT *
    FROM account_balances
    WHERE account_type = $1::text
    ORDER BY balance DESC
    LIMIT $2;`

    const { rows } = await runtime.postgres.query(query1, [ type, limit ])
    return rows
  }
},

auth: {
  strategy: 'simple-scoped-token',
  scope: ['publishers'],
  mode: 'required'
},

description: 'Used by publishers for retrieving a list of balances e.g. for an owner and their channels',

tags: [ 'api', 'publishers' ],

validate: {
  params: Joi.object().keys({
    type: accountTypeValidation.required().description('balance types to retrieve')
  }),
  query: Joi.object().keys({
    limit: Joi.number().min(1).default(10).description('the top balances to retrieve')
  }).unknown(true)
},

response: {
  schema: Joi.array().items(
    Joi.object().keys({
      account_id: Joi.string(),
      account_type: accountTypeValidation,
      balance: joiBAT.description('balance in BAT')
    })
  )
}
}

/*
   GET /v1/accounts/balances
*/

v1.getBalances = {
  handler: (runtime) => async (request, h) => {
    let {
      account: accounts,
      pending: includePending
    } = request.query
    if (!accounts) {
      throw boom.badData()
    }

    if (!Array.isArray(accounts)) {
      accounts = [accounts]
    }
    accounts = accounts.map((account) => extrasUtils.normalizeChannel(account))
    const args = [accounts]
    const checkVotes = includePending && (accounts
      .find((account) => {
        // provider name is known as publishers
        // on brave-intl/publishers's server
        const props = getPublisherProps(account)
        return props.providerName !== 'publishers'
      }))

    const votesPromise = checkVotes ? runtime.postgres.query(selectPendingAccountVotes, args) : {
      rows: []
    }
    const balancePromise = runtime.postgres.query(selectAccountBalances, args)
    const promises = [votesPromise, balancePromise]
    const results = await Promise.all(promises)

    const votesRows = results[0].rows
    const balanceRows = results[1].rows
    const body = votesRows.reduce(mergeVotes, balanceRows)

    return body
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of balances e.g. for an owner and their channels',

  tags: [ 'api', 'publishers' ],

  validate: {
    query: Joi.object().keys({
      pending: Joi.boolean().default(false).description('whether or not a query should be done for outstanding votes'),
      account: Joi.alternatives().try(
        Joi.string().description('account (channel or owner)'),
        Joi.array().items(Joi.string().required().description('account (channel or owner)'))
      ).required()
    }).unknown(true)
  },

  response: {
    schema: Joi.array().items(
      Joi.object().keys({
        account_id: Joi.string(),
        account_type: stringValidator.valid.apply(stringValidator, accountTypes),
        balance: joiBAT.description('balance in BAT')
      })
    )
  }
}

function mergeVotes (_memo, {
  channel: accountId,
  balance: voteBalance
}) {
  let memo = _memo
  const found = _.findWhere(memo, {
    account_id: accountId
  })
  if (found) {
    const amount = new BigNumber(found.balance)
    const balance = amount.plus(voteBalance).toString()
    Object.assign(found, {
      balance
    })
  } else {
    memo = memo.concat([{
      account_id: accountId,
      account_type: 'channel',
      balance: voteBalance
    }])
  }
  return memo
}

/*
   GET /v1/accounts/earnings/{type}/total
*/

v1.getEarningsTotals =
{ handler: (runtime) => {
  return async (request, h) => {
    let { type } = request.params
    let {
      order,
      limit
    } = request.query

    if (type === 'contributions') {
      type = 'contribution'
    } else if (type === 'referrals') {
      type = 'referral'
    } else {
      throw boom.badData('type must be contributions or referrals')
    }

    const query1 = queries.earnings({
      asc: order === 'asc'
    })

    const { rows } = await runtime.postgres.query(query1, [type, limit])
    return rows
  }
},

auth: {
  strategy: 'simple-scoped-token',
  scope: ['publishers'],
  mode: 'required'
},

description: 'Used by publishers for retrieving a list of top channel earnings',

tags: [ 'api', 'publishers' ],

validate: {
  params: Joi.object().keys({
    type: Joi.string().valid('contributions', 'referrals').required().description('type of earnings')
  }).unknown(true),
  query: Joi.object().keys({
    limit: Joi.number().positive().optional().default(100).description('limit the number of entries returned'),
    order: orderParam
  }).unknown(true)
},

response: {
  schema: Joi.array().items(
    Joi.object().keys({
      channel: Joi.string(),
      earnings: joiBAT.description('earnings in BAT'),
      account_id: Joi.string()
    })
  )
}
}

/*
   GET /v1/accounts/settlements/{type}/total
*/

v1.getPaidTotals =
{ handler: (runtime) => {
  return async (request, h) => {
    const { params, query } = request
    const { postgres } = runtime
    let { type } = params
    let {
      start,
      until,
      order,
      limit
    } = query

    if (type === 'contributions') {
      type = 'contribution_settlement'
    } else if (type === 'referrals') {
      type = 'referral_settlement'
    }
    let rows = []
    const options = {
      asc: order === 'asc'
    }
    if (start) {
      const dates = extrasUtils.backfillDateRange({
        start,
        until
      })
      const startDate = dates.start.toISOString()
      const untilDate = dates.until.toISOString()
      const query = queries.timeConstraintSettlements(options)
      ;({ rows } = await postgres.query(query, [type, limit, startDate, untilDate]))
    } else {
      const query = queries.allSettlements(options)
      ;({ rows } = await postgres.query(query, [type, limit]))
    }
    return rows
  }
},

auth: {
  strategy: 'simple-scoped-token',
  scope: ['publishers'],
  mode: 'required'
},

description: 'Used by publishers for retrieving a list of top channels paid out',

tags: [ 'api', 'publishers' ],

validate: {
  params: Joi.object().keys({
    type: Joi.string().valid('contributions', 'referrals').required().description('type of payout')
  }).unknown(true),
  query: Joi.object().keys({
    start: Joi.date().iso().optional().default('').description('query for the top payout in a single month beginning at this time'),
    until: Joi.date().iso().optional().default('').description('query for the top payout in a single month ending at this time'),
    limit: Joi.number().positive().optional().default(100).description('limit the number of entries returned'),
    order: orderParam
  }).unknown(true)
},

response: {
  schema: Joi.array().items(
    Joi.object().keys({
      channel: joiChannel.required(),
      paid: joiBAT.required().description('amount paid out in BAT'),
      account_id: Joi.string()
    })
  )
}
}

/*
  PUT /v1/accounts/{payment_id}/transactions/ads/{token_id}
*/
v1.adTransactions = {
  handler: (runtime) => async (request, h) => {
    const {
      params,
      payload
    } = request
    const { postgres } = runtime
    const { amount } = payload

    if (typeof process.env.ENABLE_ADS_PAYOUT === 'undefined') {
      throw boom.serverUnavailable()
    }
    if (amount <= 0) {
      throw boom.badData('amount must be greater than 0')
    }

    try {
      await transactions.insertFromAd(runtime, postgres, Object.assign({}, params, { amount }))
      return {}
    } catch (e) {
      if (e.code && e.code === '23505') { // Unique constraint violation
        throw boom.conflict('Transaction with that id exists, updates are not allowed')
      } else {
        throw boom.boomify(e)
      }
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['ads'],
    mode: 'required'
  },

  description: 'Used by ads serve for scheduling an ad viewing payout',
  tags: [ 'api', 'ads' ],

  validate: {
    params: Joi.object().keys({
      payment_id: Joi.string().required().description('The payment id to hold the transaction under'),
      token_id: Joi.string().required().description('A unique token id')
    }).unknown(true),
    payload: Joi.object().keys({
      amount: braveJoi.string().numeric().required().description('Amount of bat to pay for the ad')
    }).required()
  },

  response: { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/accounts/earnings/{type}/total').whitelist().config(v1.getEarningsTotals),
  braveHapi.routes.async().path('/v1/accounts/settlements/{type}/total').whitelist().config(v1.getPaidTotals),
  braveHapi.routes.async().path('/v1/accounts/balances/{type}/top').whitelist().config(v1.getTopBalances),
  braveHapi.routes.async().path('/v1/accounts/balances').whitelist().config(v1.getBalances),
  braveHapi.routes.async().put().path('/v1/accounts/{payment_id}/transactions/ads/{token_id}').whitelist().config(v1.adTransactions),
  braveHapi.routes.async().path('/v1/accounts/{account}/transactions').whitelist().config(v1.getTransactions)
]

module.exports.v1 = v1
