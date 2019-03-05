const BigNumber = require('bignumber.js')
const cohorts = ['control', 'grant', 'ads', 'safetynet']
const { getPublisherProps } = require('bat-publisher')
const getYoutubeChannelId = require('bat-utils/lib/youtube')
const { normalizeChannel } = require('bat-utils/lib/extras-utils')

module.exports = {
  voteValueFromSurveyor,
  fixChannel,
  cohorts
}

function voteValueFromSurveyor (runtime, surveyor, alt) {
  const { votes, probi, altcurrency } = surveyor.payload.adFree
  const decimalShift = runtime.currency.alt2scale(alt || altcurrency)
  const bigProbi = new BigNumber(probi)
  return bigProbi.dividedBy(votes).dividedBy(decimalShift)
}

async function fixChannel (channel) {
  let normalizedChannel = normalizeChannel(channel)
  const props = getPublisherProps(normalizedChannel)
  const { providerName, providerSuffix, providerValue } = props
  if (providerName === 'youtube' && providerSuffix === 'user') {
    const youtubeChannelId = await getYoutubeChannelId(providerValue)
    if (youtubeChannelId) {
      normalizedChannel = 'youtube#channel:' + youtubeChannelId
    }
  }
  return normalizedChannel
}
