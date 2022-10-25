const braveHapi = require('../../bat-utils/lib/extras-hapi.js')

module.exports = {
  hasValidCountry
}

async function hasValidCountry (runtime, channel, post = braveHapi.wreck.post) {
  const publishers = runtime.config.publishers
  const channelsToCheck = { channel_ids: [channel] }
  let result
  try {
    const response = await post(publishers.url + '/api/v3/channels/allowed_countries', {
      headers: {
        Authorization: 'Bearer ' + (publishers.access_token),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(channelsToCheck)
    })
    result = JSON.parse(response.toString())
  } catch (e) {
    return true
  }
  if (Object.hasOwn(result, channel)) {
    return result[channel]
  }
  return true
}
