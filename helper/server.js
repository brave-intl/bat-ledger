require('dotenv').config()
if (!process.env.BATUTIL_SPACES) process.env.BATUTIL_SPACES = '*,-extras.worker'
const path = require('path')
const { Runtime, hapi } = require('bat-utils')
const { controllers, server } = hapi

const config = require('../config.js')
Runtime.newrelic.setupNewrelic(config, __filename)

const options = {
  parent: path.join(__dirname, 'controllers'),
  routes: controllers.index,
  controllers: controllers,
  module: module,
  headersP: false,
  remoteP: true
}

config.database = false
config.queue = false
config.wallet = false

module.exports = server(options, new Runtime(config))
