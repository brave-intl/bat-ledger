const BigNumber = require('bignumber.js')
const {
  insertGrant: insertGrantQuery
} = require('./queries')
const zero = new BigNumber(0)
module.exports = {
  insert,
  insertGrant
}

async function insert ({
  postgres,
  client,
  grant
}) {
  const {
    id,
    createdAt,
    type,
    amount,
    channel,
    cohort,
    promotionId
  } = grant
  const bigAmount = new BigNumber(amount)
  if (zero.greaterThanOrEqualTo(amount)) {
    return []
  }
  const args = [
    id,
    createdAt,
    type,
    bigAmount.toString(),
    channel,
    cohort,
    promotionId
  ]
  const { rows } = await postgres.query(insertGrantQuery, args, client)
  return rows
}

async function insertGrant ({
  postgres,
  client,
  grant
}) {
  const {
    id,
    type,
    amount,
    channel,
    createdAt,
    promotionId,
    cohort
  } = grant
  const createdAtDate = createdAt ? new Date(createdAt) : new Date()
  const dateString = createdAtDate.toISOString()
  const params = {
    id,
    promotionId,
    createdAt: dateString,
    type,
    amount,
    channel,
    cohort
  }
  await insert({
    postgres,
    client,
    grant: params
  })
}
