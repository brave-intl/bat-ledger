let singleton

const Newrelic = function (config, runtime) {
  if (!(this instanceof Newrelic)) return new Newrelic(config, runtime)

  let newrelic = {
    startBackgroundTransaction: (name, group, cb) => { return ((cb || group)()) },
    getTransaction: () => { return { end: () => {} } },
    noticeError: (ex, params) => {},
    recordCustomEvent: (eventType, attributes) => {}
  }

  if ((!config.newrelic) || (!config.newrelic.key)) return newrelic

  if (!config.newrelic.appname) {
    if (process.env.NODE_ENV === 'production') throw new Error('config.newrelic.appname undefined')
    return newrelic
  }

  process.env.NEW_RELIC_APP_NAME = config.newrelic.appname
  process.env.NEW_RELIC_LICENSE_KEY = config.newrelic.key
  process.env.NEW_RELIC_LOG = config.newrelic.log || 'stdout'
  process.env.NEW_RELIC_NO_CONFIG_FILE = true

  return require('newrelic')
}

module.exports = function (config, runtime) {
  if (!singleton) singleton = new Newrelic(config, runtime)

  return singleton
}
