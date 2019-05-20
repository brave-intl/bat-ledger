const _ = require('underscore')
const {
  WALLET_COOLDOWN_HRS
} = process.env

module.exports = {
  adsGrantsAvailable,
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

function adsGrantsAvailable (code) {
  const { ADS_AVAILABLE_LIST } = process.env
  const adsAvailableList = ADS_AVAILABLE_LIST ? ADS_AVAILABLE_LIST.split(',') : []
  return adsAvailableList.includes(code)
}
