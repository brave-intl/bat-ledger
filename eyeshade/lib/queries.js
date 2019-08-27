const uuidv5 = require('uuid/v5')

module.exports = {
  allSettlements,
  timeConstraintSettlements,
  earnings,
  votesId,
  referralAmountByCountryCode
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

function referralAmountByCountryCode (options = {}) {
  return referralQuery = `
select amount, currency
from geo_referral_amounts
where
  country_code = $1
limit 1
`
}
