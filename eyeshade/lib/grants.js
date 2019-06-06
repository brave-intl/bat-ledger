const grantStatsQuery = `
SELECT
  count(*) as count,
  sum(amount) as amount
FROM votes
WHERE
  cohort = $1::text;
`

module.exports = {
  stats
}

async function stats (runtime, client, opts = {}) {
  const { type } = opts
  const { rows } = await client.query(grantStatsQuery, [type])
  return rows[0]
}
