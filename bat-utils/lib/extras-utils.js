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
  toBat,
  mongoUri,
  justDate
}

const DAY_MS = 60 * 60 * 24 * 1000
function mongoUri (db) {
  return `${process.env.BAT_MONGODB_URI}/${db}`
}
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

function toBat (probi) {
  return (new BigNumber(probi || 0)).dividedBy(1e18)
}

function justDate (date) {
  return (new Date(date)).toISOString().split('T')[0]
}
