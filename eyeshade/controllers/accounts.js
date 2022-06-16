const Joi = require('joi')
const { getPublisherProps } = require('bat-utils/lib/extras-publisher')
const boom = require('@hapi/boom')
const utils = require('bat-utils')
const _ = require('underscore')
const extrasUtils = require('bat-utils/lib/extras-utils')
const queries = require('../lib/queries')
const transactions = require('../lib/transaction')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const { BigNumber } = utils.extras.utils

const v1 = {}

const settlementDestinationTypes = ['uphold']
const accountTypes = ['channel', 'owner'].concat(settlementDestinationTypes)
const transactionTypes = ['contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual', 'user_deposit', 'manual_settlement']
const stringValidator = Joi.string()
const transactionTypesValidator = stringValidator.valid.apply(stringValidator, transactionTypes).description('type of the transaction')
const accountTypeValidation = stringValidator.valid.apply(stringValidator, accountTypes)
const orderParam = Joi.string().valid('asc', 'desc').optional().default('desc').description('order')
const joiChannel = Joi.string().description('The channel that earned or paid the transaction')
const joiBAT = braveJoi.string().numeric()

const selectAccountBalances = `
SELECT
  account_transactions.account_type as account_type,
  account_transactions.account_id as account_id,
  COALESCE(SUM(account_transactions.amount), 0.0) as balance
FROM account_transactions
WHERE account_id = any($1::text[])
GROUP BY (account_transactions.account_id, account_transactions.account_type);
`
const selectPendingAccountVotes = `
SELECT
  V.channel,
  SUM(V.tally * S.price)::TEXT as balance
FROM votes V
INNER JOIN surveyor_groups S
ON V.surveyor_id = S.id
WHERE
  V.channel = any($1::text[])
  AND NOT V.transacted
  AND NOT V.excluded
GROUP BY channel
`
/*
   GET /v1/accounts/{account}/transactions
*/

v1.getTransactions =
{
  handler: (runtime) => {
    return async (request, h) => {
      const account = request.params.account
      let { type } = request.query
      const args = [account]
      let typeExtension = ''
      type = _.isString(type) ? [type] : (type || [])
      if (type.length) {
        args.push(type)
        typeExtension = 'AND transaction_type = ANY($2::text[])'
      }
      const query1 = `SELECT
  created_at,
  description,
  channel,
  amount,
  from_account,
  to_account,
  to_account_type,
  settlement_currency,
  settlement_amount,
  transaction_type
FROM transactions
WHERE (
  from_account = $1
  OR to_account = $1
) ${typeExtension}
ORDER BY created_at
`

      const {
        rows: transactions
      } = await runtime.postgres.query(query1, args, true)

      const settlementTypes = {
        contribution_settlement: true,
        referral_settlement: true
      }
      return _.map(transactions, ({
        channel = '',
        created_at: createdAt,
        description,
        from_account: fromAccount,
        to_account: toAccount,
        to_account_type: toAccountType,
        amount: _amount,
        settlement_currency: settlementCurrency,
        settlement_amount: settlementAmount,
        transaction_type: transactionType
      }) => {
        let amount = new BigNumber(_amount)
        if (fromAccount === account) {
          amount = amount.negated()
        }
        const transaction = {
          from_account: fromAccount,
          to_account: toAccount,
          channel: channel || '',
          created_at: createdAt,
          description,
          amount: amount.toFixed(18)
        }
        if (settlementCurrency) {
          transaction.settlement_currency = settlementCurrency
        }
        if (settlementAmount) {
          transaction.settlement_amount = settlementAmount
        }
        if (settlementTypes[transactionType]) {
          if (toAccountType) {
            transaction.settlement_destination_type = toAccountType
          }
          if (toAccount) {
            transaction.settlement_destination = toAccount
          }
        }
        transaction.transaction_type = transactionType
        return transaction
      })
    }
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of transactions for use in statement generation, graphical dashboarding and filtering, etc.',
  tags: ['api', 'publishers'],

  validate: {
    query: Joi.object().keys({
      type: Joi.alternatives().try(
        transactionTypesValidator,
        Joi.array().items(transactionTypesValidator)
      )
    }),
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
      to_account: Joi.string().description('destination address of the settlement'),
      from_account: Joi.string().description('destination address of the settlement'),
      transaction_type: transactionTypesValidator.required()
    }))
  }
}

/*
   GET /v1/accounts/balances/{type}/top
*/

v1.getTopBalances =
{
  handler: (runtime) => {
    return async (request, h) => {
      const { limit } = request.query
      const { type } = request.params

      const { rows: reports } = await runtime.postgres.query(`
      select id from payout_reports
      order by latest_transaction_at desc`)

      const { rows } = await runtime.postgres.query(`
      select * from balance_snapshots
      where snapshot_id = $1
        and account_type = $2
      order by balance desc
      limit $3
      `, [
        reports[0].id,
        type,
        limit
      ])

      return rows
    }
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of balances e.g. for an owner and their channels',

  tags: ['api', 'publishers'],

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
   POST /v1/accounts/balances
*/

v1.getBalances = (getInputs) => ({
  handler: (runtime) => async (request, h) => {
    console.log("*****************************************************************************************************************")
    let {
      account: accounts,
      pending: includePending
    } = getInputs(request)
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

    const votesPromise = checkVotes
      ? runtime.postgres.query(selectPendingAccountVotes, args, true)
      : {
        rows: []
      }
    const balancePromise = runtime.postgres.query(selectAccountBalances, args, true)
    const promises = [votesPromise, balancePromise]
    const results = await Promise.all(promises)

    const votesRows = results[0].rows
    const balanceRows = results[1].rows
    // votes rows are missing data so we backfill
    const body = votesRows.reduce(mergeVotes, balanceRows)

    return body
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of balances e.g. for an owner and their channels',

  tags: ['api', 'publishers'],

  validate: {
    payload: Joi.object({
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
})

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
{
  handler: (runtime) => {
    return async (request, h) => {
      let { type } = request.params
      const {
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

      const { rows } = await runtime.postgres.query(query1, [type, limit], true)
      return rows
    }
  },

  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },

  description: 'Used by publishers for retrieving a list of top channel earnings',

  tags: ['api', 'publishers'],

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
{
  handler: (runtime) => {
    return async (request, h) => {
      const { params, query } = request
      const { postgres } = runtime
      let { type } = params
      const {
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
          ; ({ rows } = await postgres.query(query, [type, limit, startDate, untilDate], true))
      } else {
        const query = queries.allSettlements(options)
          ; ({ rows } = await postgres.query(query, [type, limit], true))
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

  tags: ['api', 'publishers'],

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
    const { amount } = payload

    if (typeof process.env.ENABLE_ADS_PAYOUT === 'undefined') {
      throw boom.serverUnavailable()
    }
    if (amount <= 0) {
      throw boom.badData('amount must be greater than 0')
    }

    try {
      await transactions.insertFromAd(runtime, null, Object.assign({}, params, { amount }))
      return {}
    } catch (e) {
      throw extrasUtils.postgresToBoom(e)
    }
  },
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['ads'],
    mode: 'required'
  },

  description: 'Used by ads serve for scheduling an ad viewing payout',
  tags: ['api', 'ads'],

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
  braveHapi.routes.async().post().path('/v1/accounts/balances').whitelist().config(v1.getBalances(request => request.payload)),
  braveHapi.routes.async().put().path('/v1/accounts/{payment_id}/transactions/ads/{token_id}').whitelist().config(v1.adTransactions),
  braveHapi.routes.async().path('/v1/accounts/{account}/transactions').whitelist().config(v1.getTransactions)
]

module.exports.v1 = v1
