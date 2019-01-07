const BigNumber = require('bignumber.js')

module.exports = {
  voteValueFromSurveyor
}

function voteValueFromSurveyor (runtime, surveyor, altcurrency = 'BAT') {
  const decimalShift = runtime.currency.alt2scale(altcurrency)
  const { votes, probi } = surveyor.payload.adFree
  const bigProbi = new BigNumber(probi)
  return bigProbi.dividedBy(votes).dividedBy(decimalShift)
}
