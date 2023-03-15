import fs from 'fs'
import { getPublisherProps } from './extras-publisher.js'

// this can be abstracted elsewhere as soon as we finish #274
import BigNumber from 'bignumber.js'
import boom from '@hapi/boom'
import _ from 'underscore'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

BigNumber.config({
  EXPONENTIAL_AT: 28,
  DECIMAL_PLACES: 18
})

export { BigNumber }

export const PROBI_FACTOR = 1e18
const DAY_MS = 60 * 60 * 24 * 1000
// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
export function timeout (msec) {
  return new Promise((resolve) => setTimeout(resolve, msec))
}

export function isPostgresConflict (e) {
  return e && e.code === '23505'
}

export function postgresToBoom (e) {
  if (isPostgresConflict(e)) { // Unique constraint violation
    return boom.conflict('Row with that id exists, updates are not allowed')
  } else {
    return boom.boomify(e)
  }
}

export function backfillDateRange ({
  start,
  until
}) {
  if (until) {
    return {
      start: new Date(start),
      until: new Date(until)
    }
  }
  return {
    start: new Date(start),
    until: changeMonth(start)
  }
}

export function changeMonth (date, months = 1) {
  const DAY = 1000 * 60 * 60 * 24
  let d = new Date(date)
  const currentMonth = getCurrentMonth(d)
  const delta = months > 0 ? 1 : -1
  const targetMonth = currentMonth + delta
  while (getCurrentMonth(d) !== targetMonth) {
    d = new Date(+d + (delta * DAY))
  }
  return d

  function getCurrentMonth (d) {
    const iso = d.toISOString()
    const split = iso.split('-')
    const year = +split[0]
    const month = +split[1]
    return (12 * year) + month
  }
}

export function extractJws (jws) {
  const payload = jws.split('.')[1]
  const buf = Buffer.from(payload, 'base64')
  return JSON.parse(buf.toString('utf8'))
}

// courtesy of https://stackoverflow.com/questions/31649362/json-stringify-and-unicode-characters#31652607
export function utf8ify (data) {
  if (typeof data !== 'string') data = JSON.stringify(data, null, 2)

  return data.replace(/[\u007F-\uFFFF]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).substr(-4)
  })
}

export function documentOlderThan (olderThanDays, anchorTime, _id) {
  return createdTimestamp(_id) < (anchorTime - (DAY_MS * olderThanDays))
}

export function createdTimestamp (id) {
  if (id instanceof Date) {
    return id
  }
  return new Date(parseInt(id.toHexString().substring(0, 8), 16) * 1000).getTime()
}

export function uint8tohex (arr) {
  return [].slice.call(arr).map((b) => ('00' + b.toString(16)).substr(-2)).join('')
}

export function isYoutubeChannelId (channelId) {
  const yt = /^UC[0-9A-Za-z_-]{21}[AQgw]$/i
  return yt.test(channelId)
}

export function normalizeChannel (channel) {
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

export function justDate (date) {
  return (new Date(date)).toISOString().split('T')[0]
}

export function surveyorChoices (ratio) {
  const table = [
    [3, 5, 7, 10, 20],
    [4, 6, 9, 12, 25],
    [5, 8, 11, 17, 35],
    [6, 10, 14, 20, 40],
    [9, 12, 20, 35, 50],
    [15, 25, 35, 50, 100],
    [20, 35, 50, 85],
    [30, 50, 70, 100]
  ]
  const priceIncrements = [1, 0.8, 0.6, 0.5, 0.35, 0.2, 0.15, 0.1]
  let index = _.findIndex(priceIncrements, (increment) => {
    return increment <= ratio
  })
  if (index < 0) {
    index = priceIncrements.length - 1
  }
  return table[index]
}

export function isUUID (string) {
  const uuidRegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  return uuidRegExp.test(string)
}

export function btoa (str) {
  let buffer
  if (str instanceof Buffer) {
    buffer = str
  } else {
    buffer = Buffer.from(str.toString(), 'binary')
  }
  return buffer.toString('base64')
}

export function setupKafkaCert () {
  let kafkaSslCertificate = process.env.KAFKA_SSL_CERTIFICATE
  const kafkaSslCertificateLocation = process.env.KAFKA_SSL_CERTIFICATE_LOCATION
  let kafkaSslKey = process.env.KAFKA_SSL_KEY
  const kafkaSslKeyLocation = process.env.KAFKA_SSL_KEY_LOCATION

  if (kafkaSslCertificate) {
    if (kafkaSslCertificateLocation && !fs.existsSync(kafkaSslCertificateLocation)) {
      if (kafkaSslCertificate[0] === '{') {
        const tmp = JSON.parse(kafkaSslCertificate)
        kafkaSslCertificate = tmp.certificate
        kafkaSslKey = tmp.key
      }
      fs.writeFileSync(kafkaSslCertificateLocation, kafkaSslCertificate)
    }
  }

  if (kafkaSslKey) {
    if (kafkaSslKeyLocation && !fs.existsSync(kafkaSslKeyLocation)) {
      fs.writeFileSync(kafkaSslKeyLocation, kafkaSslKey)
    }
  }
}

export function dateToISO (d) {
  return d instanceof Date ? d.toISOString() : d
}
