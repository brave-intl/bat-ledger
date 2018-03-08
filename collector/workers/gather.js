const BigNumber = require('bignumber.js')
const bson = require('bson')
const metascraper = require('metascraper')
const moment = require('moment')
const pluralize = require('pluralize')
const underscore = require('underscore')
const unfluff = require('unfluff')

const braveExtras = require('bat-utils').extras
const braveHapi = braveExtras.hapi

BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

const daily = async (debug, runtime) => {
  const database = runtime.database
  let midnight, now, tomorrow

  debug('daily', 'running')

  now = underscore.now()
  midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  midnight = Math.floor(midnight.getTime() / 1000)

  try {
    await database.purgeSince(debug, runtime, midnight * 1000)
  } catch (ex) {
    runtime.captureException(ex)
    debug('daily', { reason: ex.toString(), stack: ex.stack })
  }

  tomorrow = new Date(now)
  tomorrow.setHours(24, 0, 0, 0)
  setTimeout(() => { daily(debug, runtime) }, tomorrow - now)
  debug('daily', 'running again ' + moment(tomorrow).fromNow())
}

const periodic = async (debug, runtime) => {
  let next, now

  debug('periodic', 'running')

  try {
    await gather(debug, runtime)
  } catch (ex) {
    runtime.captureException(ex)
    debug('periodic', { reason: ex.toString(), stack: ex.stack })
  }

  now = underscore.now()
  next = now + 3 * 60 * 1000
  setTimeout(() => { periodic(debug, runtime) }, next - now)
  debug('periodic', 'running again ' + moment(next).fromNow())
}
var exports = {}

exports.initialize = async (debug, runtime) => {
  if ((typeof process.env.DYNO === 'undefined') || (process.env.DYNO === 'worker.1')) {
    setTimeout(() => { daily(debug, runtime) }, 5 * 1000)
    setTimeout(() => { periodic(debug, runtime) }, 15 * 1000)
  }
}

const gather = async (debug, runtime) => {
  const database = runtime.database
  const database2 = runtime.database2 || database
  const pseries = database.get('pseries', debug)
  const publishers = database2.get('publishers', debug)
  const voting = database2.get('voting', debug)
  const failed = []
  const handled = [ '' ]
  const warned = []
  let events, query

  events = await pseries.find({ publisher: { $ne: '' } }, { sort: { tsId: -1 }, limit: 1 })

  query = underscore.extend(((events) && (events.length > 0)) ? { _id: { $gt: events[0].tsId } } : {}, { exclude: false })
  events = await voting.find(query)

  query = underscore.omit(query, [ 'counts', 'exclude' ])
  events = events.concat(await publishers.find(query))

  for (let event of events) {
    const publisher = event.publisher
    let entry, handler, message, providerName

    if ((handled.indexOf(publisher) !== -1) || (!event.counts)) continue

    handled.push(publisher)
    entry = await publishers.findOne({ publisher: publisher })
    if (!entry) continue

    providerName = entry.providerName || 'site'
    if (failed.indexOf(providerName) !== -1) continue

    handler = handlers[providerName]
    if ((!handler) || (!runtime.config.gather[providerName])) {
      if (warned.indexOf(providerName) !== -1) continue

      warned.push(providerName)

      message = (handler ? 'no gather configuration ' : 'no gather handler') + ' for ' + providerName
      runtime.captureException(new Error(message))
      debug('gather', { providerName: providerName, message: message })
      continue
    }

    try {
      await handler(debug, runtime, event._id, entry)
    } catch (ex) {
      failed.push(providerName)

      runtime.captureException(ex)
      debug('gather', { providerName: providerName, message: ex.toString() })
      console.log(ex.stack)
    }
  }
}

const timestamp = (debug, publisher, datetime) => {
  let stamp

  if (!datetime) return

  try {
    stamp = new Date(datetime).getTime()

    if (stamp) return new bson.Timestamp(stamp % 1000, stamp / 1000)
  } catch (ex) {
    debug('gather', { publisher: publisher, reason: ex.toString() })
  }
}

const handlers = {
  site: async (debug, runtime, tsId, entry) => {
    const publisher = entry.publisher
    const sites = [ 'https://' + publisher, 'https://www.' + publisher, 'http://' + publisher, 'http://www.' + publisher ]
    const database = runtime.database
    const pseries = database.get('pseries', debug)
    let result, state

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: underscore.pick(entry, [ 'publisher', 'providerName', 'providerSuffix', 'providerValue' ])
    }

    for (let site of sites) {
      let props

      try {
        result = await braveHapi.wreck.get(site, { redirects: 3, rejectUnauthorized: true, timeout: (5 * 1000) })

        props = unfluff(result)
        state.$set.site = underscore.pick(props, [ 'title', 'softTitle', 'description', 'text' ])
        underscore.extend(state.$set.site, { url: site, modified: timestamp(debug, publisher, props.date) })

        props = await metascraper(result)
        underscore.extend(state.$set.site, underscore.pick(props, [ 'title', 'publisher', 'description' ]))
        if (!state.$set.site.modified) state.$set.site.modified = timestamp(debug, publisher, props.date)

        state.$set.site = underscore.pick(state.$set.site, (value, key) => {
          return ((value !== null) && (typeof value !== 'undefined'))
        })
        break
      } catch (ex) {
        if (!state.$set.reason) state.$set.reason = ex.toString()

        debug('gather', { publisher: site, reason: ex.toString() })
      }
    }

    await pseries.update({ tsId: tsId }, state, { upsert: true })
  },

  youtube: async (debug, runtime, tsId, entry) => {
    const config = runtime.config.gather.youtube
    const publisher = entry.publisher
    const keys = [ 'view', 'comment', 'subscriber', 'video' ]
    const database = runtime.database
    const pseries = database.get('pseries', debug)
    const url = config.url + '?part=snippet,statistics&key=' + config.api_key + '&id=' + entry.providerValue
    let result, snippet, state, statistics

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: underscore.pick(entry, [ 'publisher', 'providerName', 'providerSuffix', 'providerValue' ])
    }

    try {
      result = await braveHapi.wreck.get(url)
      if (Buffer.isBuffer(result)) result = JSON.parse(result)

      snippet = {}
      statistics = {}
      keys.forEach((key) => { statistics[pluralize(key)] = 0 })
      if ((Array.isArray(result.items)) && (result.items.length > 0)) {
        if (result.items[0].snippet) {
          snippet = underscore.pick(result.items[0].snippet, [ 'title', 'description', 'country' ])
          snippet.created = timestamp(debug, publisher, result.items[0].snippet.publishedAt)
        }

        if (result.items[0].statistics) {
          keys.forEach((key) => {
            statistics[pluralize(key)] |= result.items[0].statistics[key + 'Count']
          })
        }
      }
      underscore.extend(state.$set, { snippet: snippet, statistics: statistics })
    } catch (ex) {
      state.$set.reason = ex.toString()

      debug('gather', { publisher: publisher, reason: ex.toString() })
    }

    await pseries.update({ tsId: tsId }, state, { upsert: true })
  }
}

module.exports = exports
