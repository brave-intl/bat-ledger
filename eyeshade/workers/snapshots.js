const Cursor = require('pg-cursor')
const uuidV5 = require('uuid/v5')
const cron = require('cron-parser')
const _ = require('underscore')
const { BigNumber, justDate } = require('bat-utils/lib/extras-utils')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('update-snapshot-accounts')
}

// select * from account_balances
const getAllAccountBalancesBefore = `
select
  account_transactions.account_type,
  account_transactions.account_id,
  coalesce(sum(account_transactions.amount), 0.0)
from account_transactions
  where created_at < $1
group by (account_transactions.account_type, account_transactions.account_id);
`

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
returning *;
`

exports.createDailySnapshot = createDailySnapshot

exports.initialize = async (debug, runtime) => {
  if ((typeof process.env.DYNO !== 'undefined') && (process.env.DYNO !== 'worker.1')) return

  daily(debug, runtime)
}

function daily (debug, runtime) {
  const interval = cron.parseExpression('* * * 0 *', {
    utc: true
  })
  const date = interval.next().getTime()
  setTimeout(() => createDailySnapshot(debug, runtime, date, daily), date - _.now())
}

async function createDailySnapshot (debug, runtime, date, next) {
  const until = justDate(new Date(date))
  const result = await updateSnapshotAccounts(debug, runtime, {
    snapshotId: uuidV5(until, 'dc0befa2-37a4-4235-a5ce-dfc7d5408a78').toLowerCase(),
    until
  })
  next && next(debug, runtime)
  return result
}

exports.workers = {
  /* sent by POST /v1/snapshots/
    { queue        : 'update-snapshot-accounts'
    , message      :
      { snapshotId : 'uuid',
        until      : '2020-01-01T00:00:00.000Z'
      }
    }
  */
  'update-snapshot-accounts': updateSnapshotAccounts
}

function setupQuery (until = 'current') {
  let query = getAllAccountBalances
  const args = []
  const d = new Date(until || new Date())
  if (until !== 'current' && +d) {
    query = getAllAccountBalancesBefore
    args.push(d.toISOString())
  }
  return {
    query,
    args
  }
}

async function updateSnapshotAccounts (debug, runtime, payload) {
  const {
    snapshotId,
    until
  } = payload
  const client = await runtime.postgres.connect()
  const {
    query,
    args
  } = setupQuery(until)
  const cursor = client.query(new Cursor(query), args)
  let total = new BigNumber(0)
  let count = new BigNumber(0)
  let accounts = []
  do {
    accounts = await pullAccountBalances(cursor, 100)
    await Promise.all(accounts.map(async ({
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
  } while (accounts.length)
  await cursor.close()
  const now = (new Date()).toISOString()
  debug('update-snapshot-accounts-complete', {
    count: count.toString(),
    total: total.toString()
  })
  const { rows: snapshots } = await client.query(updateBalanceSnapshotWithTotals, [
    snapshotId,
    true,
    total.toString(),
    now
  ])
  return snapshots
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
