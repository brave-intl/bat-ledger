const Runtime = require('bat-utils/boot-runtime')
const SDebug = require('sdebug')
const owners = require('../eyeshade/lib/owners')
const debug = new SDebug('migrate-owners-table')
const { createdTimestamp } = require('bat-utils/lib/extras-utils')

module.exports = main

async function main (connections) {
  debug('connections', connections)
  const {
    postgres,
    mongo
  } = connections
  const runtime = new Runtime({
    database: mongo,
    postgres: {
      url: postgres
    }
  })
  const {
    rows: transferredOwners
  } = await runtime.postgres.query(`
SELECT * FROM owners;`)
  const ownerHash = transferredOwners.reduce((memo, row) => {
    memo[row.owner] = row
    return memo
  }, {})
  const ownersCollection = runtime.database.get('owners', debug)
  const ownersList = await ownersCollection.find({})
  await runtime.postgres.connect()

  debug('transfer start')
  for (let structure of ownersList) {
    const {
      _id,
      timestamp,
      authorized,
      owner,
      info,
      provider,
      parameters,
      defaultCurrency,
      visible
    } = structure
    // skip if owner already exists
    if (ownerHash[owner]) {
      continue
    }
    const payload = {
      provider,
      parameters,
      defaultCurrency,
      show_verification_status: visible
    }
    const createdAt = new Date(createdTimestamp(_id))
    const updatedAt = new Date(timestamp.toInt() * 1000)
    await runtime.postgres.transaction(async (scoped) => {
      await owners.create(scoped, owner, payload, authorized)
      await updateExtras(scoped, owner, {
        info,
        createdAt,
        updatedAt
      })
    })
  }
  debug('transfer complete')

  await runtime.database.db.close()
}

function updateExtras (runtime, owner, {
  info,
  createdAt,
  updatedAt
}) {
  return runtime.postgres.query(`
UPDATE owners
SET
  created_at = $2,
  updated_at = $3
WHERE
  owner = $1;`, [
    owner,
    createdAt,
    updatedAt
  ])
}
