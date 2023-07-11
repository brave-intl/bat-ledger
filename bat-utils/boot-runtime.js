import SDebug from 'bat-utils/lib/sdebug.js'
import _ from 'underscore'
import cache from './lib/runtime-cache.js'
import currency from './lib/runtime-currency.js'
import kafka from './lib/runtime-kafka.js'
import newrelic from './lib/runtime-newrelic.js'
import postgres from './lib/runtime-postgres.js'
import sentry from './lib/runtime-sentry.js'
import wreck from './lib/runtime-wreck.js'
import prometheus from './lib/runtime-prometheus.js'

const hash = {
  currency,
  kafka,
  newrelic,
  postgres,
  sentry,
  prometheus,
  wreck,
  cache
}

Object.assign(Runtime, hash)

Runtime.prototype = {
  quit: async function () {
    await Promise.all(_.keys(hash).map(async (key) => {
      const target = this[key]
      if (target && target.quit) {
        await target.quit()
      }
    }))
  },
  setup: function (config) {
    const debug = new SDebug('boot')
    _.assign(this, {
      config,
      login: config.login,
      notify: (dbg, payload) => {
        const debougie = dbg || debug
        if (payload.text) {
          debougie('notify', payload)
        }
      }
    })
    _.keys(hash).reduce(reduction(config), this)
  }
}

function Runtime (config) {
  if (!(this instanceof Runtime)) {
    return new Runtime(config)
  }

  sanity(config)
  this.setup(config)
}

function reduction (config) {
  return (memo, key) => {
    if (!config[key]) {
      return memo
    }
    const Fn = hash[key]
    memo[key] = new Fn(config, memo)
    return memo
  }
}

function sanity (config) {
  _.keys(config).forEach((key) => {
    const m = config[key]
    if (typeof m === 'undefined') {
      return
    }

    _.keys(m).forEach((k) => {
      if (typeof m[k] === 'undefined') {
        throw new Error('config.' + key + '.' + k + ': undefined')
      }

      if ((typeof m[k] !== 'number') && (typeof m[k] !== 'boolean') && (typeof m[k] !== 'object') && (!m[k])) {
        throw new Error('config.' + key + '.' + k + ': empty')
      }
    })
  })
}

export { Runtime }
