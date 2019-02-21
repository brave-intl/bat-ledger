const BigNumber = require('bignumber.js')

module.exports = {
  voteValueFromSurveyor
}

function voteValueFromSurveyor (runtime, surveyor, alt) {
  const { votes, probi, altcurrency } = surveyor.payload.adFree
  const decimalShift = runtime.currency.alt2scale(alt || altcurrency)
  const bigProbi = new BigNumber(probi)
  return bigProbi.dividedBy(votes).dividedBy(decimalShift)
}
