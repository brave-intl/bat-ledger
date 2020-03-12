const Cursor = require('pg-cursor')
const uuidV5 = require('uuid/v5')
const { BigNumber } = require('bat-utils/lib/extras-utils')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('update-snapshot-accounts')
}

const getAllAccountBalances = `
select * from account_balances
`

const upsertBalanceSnapshotAccounts = `
insert into balance_snapshot_accounts (id, snapshot_id, account_id, account_type, balance)
values ($1, $2, $3, $4, $5)
on conflict (id)
do update
  set balance = $5
returning *;
`

const updateBalanceSnapshotWithTotals = `
update balance_snapshots
  set
    completed = $2,
    total = $3,
    updated_at = $4
where id = $1
`

exports.workers = {
  /* sent by POST /v1/snapshots/
    { queue           : 'update-snapshot-accounts'
    , message         :
      { snapshotId    : 'uuid'
      }
    }
  */
  'update-snapshot-accounts': async (debug, runtime, payload) => {
    try {
      const { snapshotId } = payload
      const client = await runtime.postgres.connect()
      const cursor = client.query(new Cursor(getAllAccountBalances))
      let total = new BigNumber(0)
      let count = new BigNumber(0)
      let rows = [{}]
      while (rows.length) {
        rows = await pullAccountBalances(cursor, 100)
        await Promise.all(rows.map(async ({
          account_id: accountId,
          account_type: accountType,
          balance
        }) => {
          const id = uuidV5(`${accountType}-${accountId}`, snapshotId)
          await client.query(upsertBalanceSnapshotAccounts, [
            id,
            snapshotId,
            accountId,
            accountType,
            balance
          ])
          count = count.plus(1)
          total = total.plus(balance)
        }))
      }
      await cursor.close()
      const now = (new Date()).toISOString()
      debug('update-snapshot-accounts-complete', {
        count: count.toString(),
        total: total.toString()
      })
      await client.query(updateBalanceSnapshotWithTotals, [
        snapshotId,
        true,
        total.toString(),
        now
      ])
    } catch (e) {
      console.log(e)
    }
  }
}

async function pullAccountBalances (cursor, maxResults) {
  // iterator not supported yet
  return new Promise((resolve, reject) =>
    cursor.read(maxResults, async (err, rows) => {
      if (err) {
        return reject(err)
      }
      resolve(rows)
    })
  )
}
