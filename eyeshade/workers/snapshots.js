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
`

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
    until
  } = payload
  const maxTime = new Date(until || new Date())
  const client = await runtime.postgres.connect()
  const now = new Date()
  const args = [snapshotId, maxTime]
  try {
    await client.query('BEGIN')
    await client.query(writeAccountBalancesBefore, args)
    await client.query(updatePayoutReportWithTotals, [
      snapshotId,
      true,
      now.toISOString(),
      maxTime.toISOString()
    ])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
  } finally {
    client.release()
  }
}
