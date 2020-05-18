const Joi = require('@hapi/joi')
const utils = require('bat-utils')
const boom = require('boom')
const braveHapi = utils.extras.hapi
const braveUtils = utils.extras.utils
const braveJoi = utils.extras.joi

const v1 = {}

const snapshotIdValidator = Joi.alternatives().try(
  Joi.date().iso().description('The date that filtered a snapshot'),
  Joi.string().guid().description('The id that should be tied to a snapshot')
)
const createdAtValidator = Joi.date().iso().required().description('The time when the snapshot was created')
const updatedAtValidator = Joi.date().iso().required().description('The time when the snapshot was last updated')
const untilValidator = Joi.date().iso().optional().description('The time when the snapshot should consider transactions until')
const balanceValidator = braveJoi.string().numeric().required().description('The value of the account in the snapshot')
const completedValidator = Joi.bool().required().description('whether or not the snapshot is complete')
const accountTypeValidator = Joi.string().required().description('The type of account')
const accountIdValidator = Joi.string().required().description('The id of the account')
const accountBalanceValidator = Joi.object().keys({
  balance: balanceValidator,
  accountType: accountTypeValidator,
  accountId: accountIdValidator
})
const accountBalancesListValidator = Joi.array().items(accountBalanceValidator).required().description('The list of account balances')

const fullSnapshotValidator = Joi.object().keys({
  id: snapshotIdValidator,
  completed: completedValidator,
  createdAt: createdAtValidator,
  updatedAt: updatedAtValidator,
  items: accountBalancesListValidator
})

const upsertPayoutReport = `
insert into payout_reports (id)
values ($1)
`
const getOnePayoutReport = `
select
  id,
  completed,
  created_at as "createdAt",
  updated_at as "updatedAt"
from payout_reports
where
  id = $1
limit 1
`
const getBalanceSnapshots = `
select
  account_id as "accountId",
  account_type as "accountType",
  balance
from balance_snapshots
where
  snapshot_id = $1
`

v1.createSnapshot = {
  handler: createSnapshotHandler,
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers'],
    mode: 'required'
  },
  description: 'Used by antifraud service for generating payload snapshots',
  tags: ['api', 'publishers'],
  validate: {
    headers: Joi.object().keys({
      'content-type': Joi.string().allow('application/json')
    }).unknown(true),
    payload: Joi.object().keys({
      until: untilValidator,
      snapshotId: snapshotIdValidator
    }).unknown(true)
  },
  response: {
    schema: Joi.object().keys({
      snapshotId: snapshotIdValidator
    })
  }
}

v1.getFullSnapshot = {
  handler: getFullSnapshotHandler,
  auth: {
    strategy: 'simple-scoped-token',
    scope: ['publishers', 'antifraud'],
    mode: 'required'
  },
  description: 'Used by antifraud service for generating payload snapshots',
  tags: ['api', 'publishers', 'antifraud'],
  validate: {
    query: Joi.object().keys({
      account: Joi.alternatives().try(
        Joi.string().description('account (channel or owner)'),
        Joi.array().items(Joi.string().required().description('account (channel or owner)'))
      ).optional()
    }).unknown(true),
    params: Joi.object().keys({
      snapshotId: snapshotIdValidator
    }).unknown(true)
  },
  response: {
    schema: fullSnapshotValidator
  }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/snapshots/').whitelist().config(v1.createSnapshot),
  braveHapi.routes.async().path('/v1/snapshots/{snapshotId}').whitelist().config(v1.getFullSnapshot)
]

function createSnapshotHandler (runtime) {
  return async (request, h) => {
    const debug = braveHapi.debug(module, request)
    const { snapshotId, until } = request.payload
    try {
      await runtime.postgres.query(upsertPayoutReport, [snapshotId])
    } catch (e) {
      throw braveUtils.postgresToBoom(e)
    }
    await runtime.queue.send(debug, 'update-snapshot-accounts', {
      snapshotId,
      until
    })
    return h.response({
      snapshotId
    }).code(201)
  }
}

function getFullSnapshotHandler (runtime) {
  return async (request, h) => {
    const { snapshotId } = request.params
    let { account: accounts = [] } = request.query
    // this can probably done in one query
    const {
      rows: snapshots,
      rowCount
    } = await runtime.postgres.query(getOnePayoutReport, [snapshotId], true)
    if (!rowCount) {
      throw boom.notFound()
    }
    const snapshot = snapshots[0]
    snapshot.items = []
    if (!snapshot.completed) {
      return h.response(snapshot).code(202)
    }
    let query = getBalanceSnapshots
    const args = [snapshotId]
    if (!Array.isArray(accounts)) {
      accounts = [accounts]
    }
    if (accounts.length) {
      accounts = accounts.map((account) => braveUtils.normalizeChannel(account))
      query += 'and account_id = any($2::text[])'
      args.push(accounts)
    }
    const { rows: accountBalances } = await runtime.postgres.query(query, args, true)
    snapshot.items = accountBalances
    return snapshot
  }
}
