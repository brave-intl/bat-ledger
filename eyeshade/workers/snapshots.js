const uuidV5 = require('uuid/v5')
const cron = require('cron-parser')
const _ = require('underscore')
const { justDate } = require('bat-utils/lib/extras-utils')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('update-snapshot-accounts')
}

const writeAccountBalancesBefore = `
insert into balance_snapshots (snapshot_id, account_id, account_type, balance)
  select
    $1 as snapshot_id,
    account_transactions.account_id,
    account_transactions.account_type,
    coalesce(sum(account_transactions.amount), 0.0) as "balance"
  from account_transactions
    where created_at < $2
  group by (account_transactions.account_type, account_transactions.account_id);
`

const updatePayoutReportWithTotals = `
update payout_reports
  set
    completed = $2,
    updated_at = $3,
    latest_transaction_at = $4
where id = $1
returning *;
`

exports.createDailySnapshot = createDailySnapshot
exports.updateSnapshotAccounts = updateSnapshotAccounts

exports.initialize = async (debug, runtime) => {
  if ((typeof process.env.DYNO !== 'undefined') && (process.env.DYNO !== 'worker.1')) return

  daily(debug, runtime)
}

function daily (debug, runtime) {
  const interval = cron.parseExpression('* 0 * * *', {
    utc: true
  })
  const date = interval.next().getTime()
  setTimeout(() => createDailySnapshot(debug, runtime, date, daily), date - _.now())
}

async function createDailySnapshot (debug, runtime, date, next) {
  const until = justDate(new Date(date))
  const snapshotId = uuidV5(until, 'dc0befa2-37a4-4235-a5ce-dfc7d5408a78').toLowerCase()
  const result = await updateSnapshotAccounts(debug, runtime, {
    snapshotId,
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

async function updateSnapshotAccounts (debug, runtime, payload) {
  const {
    snapshotId,
    until = new Date()
  } = payload
  const client = await runtime.postgres.connect()
  const now = new Date()
  const maxTime = until === 'current' ? now : new Date(until)
  const args = [snapshotId, maxTime]
  try {
    await client.query('BEGIN')
    await client.query(writeAccountBalancesBefore, args)
    const {
      rows: snapshots
    } = await client.query(updatePayoutReportWithTotals, [
      snapshotId,
      true,
      now.toISOString(),
      maxTime.toISOString()
    ])
    await client.query('COMMIT')
    return snapshots[0]
  } catch (e) {
    await client.query('ROLLBACK')
  } finally {
    client.release()
  }
}
