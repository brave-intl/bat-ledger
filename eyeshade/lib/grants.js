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

module.exports = {
  stats
}

async function stats (runtime, client, options = {}) {
  const { type, start, until } = options
  const { rows } = await client.query(grantStatsQuery, [type, start / 1000, until / 1000])
  console.log((await client.query(`select * from votes where cohort = $1;`, [type])).rows)
  return rows[0]
}
