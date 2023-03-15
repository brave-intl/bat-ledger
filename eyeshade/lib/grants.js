const grantStatsQuery = `
SELECT
  count(*) as count,
  sum(amount) as amount
FROM votes
WHERE
    cohort = $1::text
AND created_at >= to_timestamp($2)
AND created_at < to_timestamp($3);
`

export default {
  stats
}

async function stats (runtime, options = {}) {
  const { type, start, until } = options
  const { rows } = await runtime.postgres.query(grantStatsQuery, [type, start / 1000, until / 1000], true)
  return rows[0]
}
