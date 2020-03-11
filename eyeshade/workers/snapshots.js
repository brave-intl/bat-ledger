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
    completed = $2
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
    const { snapshotId } = payload
    const client = await runtime.postgres.connect()
    const cursor = client.query(new Cursor(getAllAccountBalances))
    const iterator = forEachCursor(cursor)
    let total = new BigNumber(0)
    let count = new BigNumber(0)
    let iterated
    while ((iterated = iterator.next())) {
      const { done, value: promise } = iterated
      const rows = await promise
      if (done) {
        break
      }
      await Promise.all(rows.map(async ({
        account_id: accountId,
        account_type: accountType,
        balance
      }) => { // parallelizing is ok
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
    // await updateSnapshotAccounts(cursor, (row) => {
    //   const id = uuidV5(`${row.account_type}-${row.account_id}`, snapshotId)
    //   await client.query(upsertBalanceSnapshotAccounts, [
    //     id,
    //     snapshotId,
    //     row.account_id,
    //     row.account_type,
    //     row.balance
    //   ])
    //   count = count.plus(1)
    //   total = total.plus(balance)
    // })
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
  }
}

async function * forEachCursor (cursor) {
  let promise = Promise.resolve([])
  while ((promise = read(cursor, 100))) {
    const rows = await promise
    if (!rows.length) {
      break
    }
    yield rows
  }
}

function read (cursor, count) {
  return new Promise((resolve, reject) =>
    cursor.read(count, (err, rows) => {
      if (err) {
        reject(err)
      }
      resolve(rows)
    })
  )
}

// async function updateSnapshotAccounts(cursor, handler) {
//   return new Promise((resolve, reject) =>
//     cursor.read(100, async (err, rows) => {
//       if (err) {
//         return reject(err)
//       }
//       await Promise.all(rows.map(handler))
//       await updateSnapshotAccounts(cursor, handler)
//       resolve()
//     })
//   )
// }
