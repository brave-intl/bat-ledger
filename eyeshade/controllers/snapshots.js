const Joi = require('@hapi/joi')
const utils = require('bat-utils')
const boom = require('boom')
const braveHapi = utils.extras.hapi
const braveUtils = utils.extras.utils
const braveJoi = utils.extras.joi

const v1 = {}

const snapshotIdValidator = Joi.string().guid().description('The id that should be tied to a snapshot')
const createdAtValidator = Joi.date().iso().required().description('The time when the snapshot was created')
const updatedAtValidator = Joi.date().iso().required().description('The time when the snapshot was last updated')
const totalValidator = braveJoi.string().numeric().required().description('The total value in the snapshot')
const balanceValidator = braveJoi.string().numeric().required().description('The value of the account in the snapshot')
const completedValidator = Joi.bool().required().description('whether or not the snapshot is complete')
const accountTypeValidator = Joi.string().required().description('The type of account')
const accountIdValidator = Joi.string().required().description('The id of the account')
const accountBalanceValidator = Joi.object().keys({
  balance: balanceValidator,
  account_type: accountTypeValidator,
  account_id: accountIdValidator
})
const accountBalancesListValidator = Joi.array().items(accountBalanceValidator).required().description('The list of account balances')

const fullSnapshotValidator = Joi.object().keys({
  id: snapshotIdValidator,
  completed: completedValidator,
  createdAt: createdAtValidator,
  updatedAt: updatedAtValidator,
  total: totalValidator,
  items: accountBalancesListValidator
})

const upsertBalanceSnapshot = `
insert into balance_snapshots (id)
values ($1)
returning *;
`
const getOneSnapshotBalance = `
select
  id,
  completed,
  created_at as "createdAt",
  updated_at as "updatedAt",
  total
from balance_snapshots
where
  id = $1
limit 1
`
const getSnapshotBalanceAccounts = `
select
  account_id as "accountId",
  account_type as "accountType",
  balance
from
  balance_snapshot_accounts
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
    payload: Joi.object().keys({
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
    const { snapshotId } = request.payload
    try {
      await runtime.postgres.query(upsertBalanceSnapshot, [snapshotId])
    } catch (e) {
      throw braveUtils.postgresToBoom(e)
    }
    await runtime.queue.send(debug, 'update-snapshot-accounts', {
      snapshotId
    })
    return {
      snapshotId
    }
  }
}

function getFullSnapshotHandler (runtime) {
  return async (request, h) => {
    const { snapshotId } = request.params
    const client = await runtime.postgres.connect()
    // try {
    //   await client.query('BEGIN')
    // this can probably done in one query
    const { rows: snapshots, rowCount } = await client.query(getOneSnapshotBalance, [snapshotId])
    if (!rowCount) {
      throw boom.notFound()
    }
    const snapshot = snapshots[0]
    snapshot.items = []
    if (!snapshot.completed) {
      return h.response(snapshot).code(202)
    }
    const { rows: accountBalances } = await client.query(getSnapshotBalanceAccounts, [snapshotId])
    snapshot.items = accountBalances
    // await client.query('COMMIT')
    return snapshot
    // } catch (e) {
    //   await client.query('ROLLBACK')
    //   throw boom.boomify(e)
    // }
  }
}
