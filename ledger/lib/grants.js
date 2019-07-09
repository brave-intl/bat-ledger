const _ = require('underscore')
const {
  ADS_URL,
  ADS_AVAILABLE_LIST,
  WALLET_COOLDOWN_HRS
} = process.env
const {
  wreck
} = require('bat-utils/lib/extras-hapi')
const adsAvailableList = getAdsAvailableList()

module.exports = {
  adsGrantsAvailable,
  getCohort,
  defaultCooldownHrs,
  cooldownOffset
}

function defaultCooldownHrs (hours) {
  const hrs = _.isUndefined(hours) ? WALLET_COOLDOWN_HRS : hours
  return hrs ? (+hrs || 0) : 24
}

function cooldownOffset (hours = defaultCooldownHrs()) {
  return hours * 60 * 60 * 1000
}

async function adsGrantsAvailable (code) {
  const list = await adsAvailableList
  console.log("ads list: " + list)
  console.log("geo header: " + code)
  return list.includes(code)
}

async function getAdsAvailableList () {
  try {
    const bytes = await wreck.get(`${ADS_URL}/v1/geoCode`, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
    const string = bytes.toString()
    const json = JSON.parse(string)
    return json.map(({ code }) => code)
  } catch (e) {
    const backup = ADS_AVAILABLE_LIST || 'US'
    return backup.split(',')
  }
}

function getCohort (grants, ids) {
  const targetGrant = _.find(grants, ({ grantId }) => ids.includes(grantId))
  const defaultCohortType = 'grant'
  const { type: targetGrantType } = targetGrant
  return targetGrantType === 'ugp' ? defaultCohortType : (targetGrantType || defaultCohortType)
}
