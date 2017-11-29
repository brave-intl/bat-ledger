require('dotenv').config()
if (!process.env.BATUTIL_SPACES) process.env.BATUTIL_SPACES = '*,-hapi'

const os = require('os')
const path = require('path')

const tldjs = require('tldjs')
const underscore = require('underscore')

const config = require('../config.js')
if (config.newrelic) {
  if (!config.newrelic.appname) {
    config.newrelic.appname = 'bat-' + process.env.SERVICE + '-worker@' +
      ((process.env.NODE_ENV !== 'production') ? os.hostname() : tldjs.getSubdomain(process.env.HOST))
  }
  process.env.NEW_RELIC_APP_NAME = config.newrelic.appname

  require(path.join('..', 'bat-utils', 'lib', 'runtime-newrelic'))(config)
}

const utils = require('bat-utils')

const options = {
  parent: path.join(__dirname, 'workers'),
  module: module
}

config.cache = false

utils.extras.worker(options, new utils.Runtime(config))
