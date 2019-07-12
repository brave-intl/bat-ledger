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

function getCohort (grants, ids, availableCohorts) {
  const targetGrant = _.find(grants, ({ grantId }) => ids.includes(grantId))
  let { type: targetGrantType } = targetGrant

  let cohort = 'grant'
  if (targetGrantType) {
    if (targetGrantType === 'android') {
      targetGrantType = 'safetynet'
    }
    // we've already executed the transfer so we must succeed at this point
    // using the grant cohort is better than erroring
    if (availableCohorts.includes(targetGrantType)) {
      cohort = targetGrantType
    }
  }

  return cohort
}
