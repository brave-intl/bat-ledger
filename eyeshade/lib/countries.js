import underscore from 'underscore'
import boom from '@hapi/boom'
import { BigNumber } from 'bat-utils/lib/extras-utils.js'

export default {
  computeValue,
  resolve
}

function resolve (_rows) {
  let rows = _rows
  // if this can be done in sql please fix!
  const resolver = rows.reduce((memo, { codes, id, activeAt }) => {
    return codes.reduce((memo, code) => {
      const group = { id, activeAt }
      const byCode = memo[code] = memo[code] || group
      if (byCode.id !== id && new Date(byCode.activeAt) < new Date(activeAt)) {
        memo[code] = group
      }
      return memo
    }, memo)
  }, {})
  rows = rows.map((row) => Object.assign({}, row, {
    codes: row.codes.filter((code) => row.id === resolver[code].id)
  })).filter(({ codes }) => codes.length)
  return rows
}

async function computeValue ({ currency, config }, passedGroupId, referralGroups) {
  const defaultCurrency = 'BAT'
  const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
  const countryGroupId = passedGroupId || originalRateId
  const country = underscore.findWhere(referralGroups, {
    // no group has falsey id
    id: countryGroupId
  })
  if (!country) {
    throw boom.notFound('referral group not found')
  }
  const {
    amount: groupAmount,
    currency: groupCurrency
  } = country

  // does caching so only 1 will do a request for each currency at max
  const probiString = await currency.fiat2alt(
    groupCurrency,
    groupAmount,
    config.altcurrency || defaultCurrency
  )
  return {
    probi: new BigNumber(probiString),
    value: groupAmount,
    currency: groupCurrency,
    countryGroupId
  }
}
