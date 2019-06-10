const BigNumber = require('bignumber.js')
const utils = require('bat-utils/lib/extras-utils')
const compositePromotionIdExclusions = {
  // promotionIDs that should not be added to total
  '74bc56a0-f4f9-4ac5-84a7-65e9babc41ff': 10,
  'f66eac41-22b1-4c11-94ce-9c504d0539d8': 5,
  'c7a12742-2c7c-4ffc-9732-0e601e844099': 60
}
module.exports = {
  compositePromotionIdExclusions,
  compositeBonusAmounts,
  createComposite
}

function compositeBonusAmounts (promotionId) {
  return new BigNumber(compositePromotionIdExclusions[promotionId] || 0).times(utils.PROBI_FACTOR)
}

function createComposite ({
  type,
  amount = 0,
  lastClaim: date
}) {
  const lastClaim = date && new Date(date)
  return {
    type,
    amount: (new BigNumber(amount)).toString(),
    lastClaim: lastClaim ? lastClaim.toISOString() : null
  }
}
