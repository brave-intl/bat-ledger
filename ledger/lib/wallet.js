const BigNumber = require('bignumber.js')
const promotionIdExclusions = {
  'cba1e5c0-8081-49cb-b4b8-05e109c96fd4': true,
  'f8913681-eab9-48c2-890e-c40d4a3efb95': true,
  '1a9f55c7-6d54-41c6-97cd-7b8c4a290641': true,
  'c7a12742-2c7c-4ffc-9732-0e601e844099': true,
  'f66eac41-22b1-4c11-94ce-9c504d0539d8': true,
  '74bc56a0-f4f9-4ac5-84a7-65e9babc41ff': true,
  'bc4d2067-dfe6-4f9b-9bf7-5bd80ec99180': true
}
const promotionIdBonuses = {
  '21870643-7e03-4b0b-a0c4-b9e1eb9b046c': '25'
}
module.exports = {
  promotionIdExclusions,
  promotionIdBonuses,
  createComposite
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
