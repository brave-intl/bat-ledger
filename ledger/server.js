require('dotenv').config()
if (!process.env.BATUTIL_SPACES) process.env.BATUTIL_SPACES = '*,-extras.worker'

const os = require('os')
const path = require('path')

const tldjs = require('tldjs')

const config = require('../config.js')
if (config.newrelic) {
  if (!config.newrelic.appname) {
    const appname = path.parse(__filename).name

    if (process.env.NODE_ENV === 'production') {
      config.newrelic.appname = appname + '@' + tldjs.getSubdomain(process.env.HOST)
    } else {
      config.newrelic.appname = 'bat-' + process.env.SERVICE + '-' + appname + '@' + os.hostname()
    }
  }
  process.env.NEW_RELIC_APP_NAME = config.newrelic.appname

  require(path.join('..', 'bat-utils', 'lib', 'runtime-newrelic'))(config)
}

const utils = require('bat-utils')

const options = {
  parent: path.join(__dirname, 'controllers'),
  routes: utils.hapi.controllers.index,
  controllers: utils.hapi.controllers,
  module: module,
  headersP: false,
  remoteP: false
}

config.cache = false

module.exports = utils.hapi.server(options, new utils.Runtime(config))
