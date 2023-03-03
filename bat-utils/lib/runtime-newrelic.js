import tldjs from 'tldjs'
import os from 'os'
import path from 'path'

let singleton

function Newrelic (config, runtime) {
  const newrelic = {
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

  return import('newrelic')
}

function createNewrelic (config, runtime) {
  if (!singleton) singleton = new Newrelic(config, runtime)

  return singleton
}

function setup (config, fName) {
  if (config.newrelic) {
    if (!config.newrelic.appname) {
      const appname = path.parse(fName).name

      if (process.env.NODE_ENV === 'production') {
        config.newrelic.appname = appname + '.' + tldjs.getSubdomain(process.env.HOST)
      } else {
        config.newrelic.appname = 'bat-' + process.env.SERVICE + '-' + appname + '@' + os.hostname()
      }
    }
    process.env.NEW_RELIC_APP_NAME = config.newrelic.appname

    createNewrelic(config)
  }
}

createNewrelic.setupNewrelic = setup
export default createNewrelic
