const getSnapshotsQuery = `
SELECT *
FROM snapshots
WHERE target_date >= $1
  AND target_date < $2;
`
const topEarnersByType = `
SELECT
  account_id as id,
  account_type as type,
  balance
FROM account_balances
WHERE account_type = $1::text
ORDER BY balance DESC
LIMIT $2;
`
const aggregateVotesQuery = `
SELECT
  COUNT(DISTINCT channel) AS channel,
  SUM(amount) AS amount,
  SUM(fees) AS fees, cohort
FROM votes
GROUP BY cohort;
`
const aggregateTransactionsQuery = `
SELECT
  COUNT(distinct channel) AS channel,
  SUM(amount) AS amount,
  transaction_type AS type
FROM transactions
GROUP BY transaction_type;
`
const insertSnapshotQuery = `
INSERT INTO snapshots (target_date, transactions, votes, top)
VALUES ($1, $2, $3, $4);
`
const distinctAccountTypes = `
SELECT distinct account_type as type
FROM account_balances;
`

module.exports = {
  aggregateTransactions,
  aggregateVotes,
  generateSnapshot,
  insertSnapshot,
  getSnapshots
}

async function getSnapshots (runtime, client, options) {
  const { start, end } = options
  const endDate = end || new Date(+start + (1000 * 60 * 60 * 24))
  const { rows } = await client.query(getSnapshotsQuery, [start.toISOString(), endDate.toISOString()])
  return rows.map(({
    transactions,
    votes,
    top,
    created_at: createdAt,
    target_date: targetDate
  }) => ({
    createdAt,
    targetDate,
    transactions,
    votes,
    top
  }))
}

async function aggregateTransactions (runtime, client) {
  const { rows } = await client.query(aggregateTransactionsQuery)
  return rows
}

async function aggregateVotes (runtime, client) {
  const { rows } = await client.query(aggregateVotesQuery)
  return rows
}

async function topEarners (runtime, client, options) {
  const { limit } = options
  const { postgres } = runtime
  const { rows: earners } = await postgres.query(distinctAccountTypes)
  const earnersPromises = earners.map(({
    type
  }) => postgres.query(topEarnersByType, [type, limit]).then(({
    rows
  }) => ({ [type]: rows })))
  const results = await Promise.all(earnersPromises)
  return Object.assign({}, ...results)
}

async function generateSnapshot (runtime, client, options) {
  const snapshot = await getSnapshots(runtime, client, {
    start: options.date
  })
  if (snapshot.length) {
    return
  }
  const votesPromise = aggregateVotes(runtime, client, options)
  const transactionsPromise = aggregateTransactions(runtime, client, options)
  const topPromise = topEarners(runtime, client, {
    limit: 100
  })
  const [
    votes,
    transactions,
    top
  ] = await Promise.all([
    votesPromise,
    transactionsPromise,
    topPromise
  ])
  const data = {
    date: options.date,
    top,
    votes,
    transactions
  }
  await insertSnapshot(runtime, client, data)
}

async function insertSnapshot (runtime, client, options) {
  const { date, transactions, votes, top } = options
  // created_at is created for us
  await client.query(insertSnapshotQuery, [date, JSON.stringify(transactions), JSON.stringify(votes), top])
}
