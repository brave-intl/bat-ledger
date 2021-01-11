const { v5: uuidv5 } = require('uuid')

module.exports = {
  allSettlements,
  timeConstraintSettlements,
  earnings,
  referralGroups,
  getActiveCountryGroups,
  votesId
}

function votesId (channel, cohort, surveyorId) {
  return uuidv5(channel + cohort + surveyorId, 'f0ca8ff9-8399-493a-b2c2-6d4a49e5223a')
}

function earnings (options = {}) {
  const {
    asc
  } = options
  const order = asc ? 'ASC' : 'DESC'
  return `
 select
   channel,
   coalesce(sum(amount), 0.0) as earnings,
   account_id
 from account_transactions
 where account_type = 'owner' and transaction_type = $1
 group by (account_id, channel)
 order by earnings ${order}
 limit $2;`
}

function allSettlements (options = {}) {
  const {
    asc
  } = options
  const order = asc ? 'ASC' : 'DESC'
  return `
 select
   channel,
   coalesce(sum(-amount), 0.0) as paid,
   account_id
 from account_transactions
 where account_type = 'owner' and transaction_type = $1
 group by (account_id, channel)
 order by paid ${order}
 limit $2;`
}

function timeConstraintSettlements (options = {}) {
  const {
    asc
  } = options
  const order = asc ? 'ASC' : 'DESC'
  return `
 select
   channel,
   coalesce(sum(-amount), 0.0) as paid,
   account_id
 from account_transactions
 where
       account_type = 'owner'
   and transaction_type = $1
   and created_at >= $3
   and created_at < $4
 group by (account_id, channel)
 order by paid ${order}
 limit $2;`
}

function referralGroups () {
  return `
SELECT
  id,
  active_at as "activeAt",
  name,
  amount,
  currency,
  countries.codes AS codes
FROM geo_referral_groups, (
  SELECT
    group_id,
    array_agg(country_code) AS codes
  FROM geo_referral_countries
  GROUP BY group_id
) AS countries
WHERE
    geo_referral_groups.active_at <= $1
AND countries.group_id = geo_referral_groups.id;`
}

function getActiveCountryGroups () {
  return `
  SELECT
    id,
    amount,
    currency,
    active_at AS "activeAt"
  FROM geo_referral_groups
  WHERE
    active_at <= CURRENT_TIMESTAMP
  ORDER BY active_at DESC;`
}
