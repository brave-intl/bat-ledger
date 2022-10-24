const braveHapi = require('../../bat-utils/lib/extras-hapi.js')

module.exports = {
  hasValidCountry
}

async function hasValidCountry (runtime, channel) {
  const publishers = runtime.config.publishers
  const channelsToCheck = { channel_ids: [channel] }
  const response = await braveHapi.wreck.post(publishers.url + '/api/v3/public/channels/allowed_countries', {
    headers: {
      Authorization: 'Bearer ' + (publishers.access_token),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(channelsToCheck)
  })
  const result = JSON.parse(response.toString())

  if (result[channel]) {
    return result[channel]
  }
  return false
}
