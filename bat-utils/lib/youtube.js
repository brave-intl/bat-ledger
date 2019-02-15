'use strict'

const braveHapi = require('./extras-hapi')

async function getYoutubeChannelId (youtubeUsername) {
  const youtubeApiKey = process.env.YOUTUBE_API_KEY
  const youtubeApiBaseUri = process.env.YOUTUBE_API_BASE_URI || 'https://www.googleapis.com'

  let response = await braveHapi.wreck.get(`${youtubeApiBaseUri}/youtube/v3/channels?part=id&forUsername=${youtubeUsername}&key=${youtubeApiKey}`)
  response = JSON.parse(response)

  return response.items[0].id
}

module.exports = getYoutubeChannelId
