const getPublisherProps = require('bat-publisher').getPublisherProps
// this can be abstracted elsewhere as soon as we finish #274
const BigNumber = require('bignumber.js')
 const dotenv = require('dotenv')
 dotenv.config()
 BigNumber.config({
  EXPONENTIAL_AT: 28,
  DECIMAL_PLACES: 18
})

module.exports = {
  timeout,
  extractJws,
  utf8ify,
  uint8tohex,
  createdTimestamp,
  documentOlderThan,
  isYoutubeChannelId,
  normalizeChannel,
  justDate
}

const DAY_MS = 60 * 60 * 24 * 1000
// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
function timeout (msec) {
  return new Promise((resolve) => setTimeout(resolve, msec))
}

function extractJws (jws) {
  const payload = jws.split('.')[1]
  const buf = Buffer.from(payload, 'base64')
  return JSON.parse(buf.toString('utf8'))
}

// courtesy of https://stackoverflow.com/questions/31649362/json-stringify-and-unicode-characters#31652607
function utf8ify (data) {
  if (typeof data !== 'string') data = JSON.stringify(data, null, 2)

  return data.replace(/[\u007F-\uFFFF]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).substr(-4)
  })
}

function documentOlderThan (olderThanDays, anchorTime, _id) {
  return createdTimestamp(_id) < (anchorTime - (DAY_MS * olderThanDays))
}

function createdTimestamp (id) {
  return new Date(parseInt(id.toHexString().substring(0, 8), 16) * 1000).getTime()
}

function uint8tohex (arr) {
  return [].slice.call(arr).map((b) => ('00' + b.toString(16)).substr(-2)).join('')
}

function isYoutubeChannelId (channelId) {
  const yt = new RegExp(/^UC[0-9A-Za-z_-]{21}[AQgw]$/i)
  return yt.test(channelId)
}

function normalizeChannel (channel) {
  const props = getPublisherProps(channel)
  if (props.providerName) {
    if (props.providerName === 'twitch') {
      return `${props.providerName}#author:${props.providerValue}`
    } else if (props.providerName === 'youtube') {
      if (!isYoutubeChannelId(props.providerValue)) {
        return `${props.providerName}#user:${props.providerValue}`
      }
    }
  }
  return channel
}

function justDate (date) {
  return (new Date(date)).toISOString().split('T')[0]
}
