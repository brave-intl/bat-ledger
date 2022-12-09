
const path = require('path')

const SDebug = require('sdebug')
const _ = require('underscore')

const cache = require('./lib/runtime-cache')
const currency = require('./lib/runtime-currency')
const kafka = require('./lib/runtime-kafka')
const newrelic = require('./lib/runtime-newrelic')
const postgres = require('./lib/runtime-postgres')
const prometheus = require('./lib/runtime-prometheus')
const sentry = require('./lib/runtime-sentry')
const database = require('./lib/runtime-database')
const wreck = require('./lib/runtime-wreck')

const hash = {
  cache,
  currency,
  kafka,
  newrelic,
  database,
  postgres,
  prometheus,
  sentry,
  wreck
}

module.exports = Object.assign(Runtime, hash)

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

  if (!config) {
    config = process.env.NODE_ENV || 'development'
  }
  if (typeof config === 'string') {
    config = require(path.join(process.cwd(), 'config', 'config.' + config + '.js'))
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
