const dotenv = require('dotenv')
const { join } = require('path')
const config = require('../config.js')
const utils = require('../bat-utils')

const {
  hapi,
  Runtime
} = utils

dotenv.config()

Runtime.newrelic.setupNewrelic(config, __filename)

const {
  controllers,
  server: hapiServer
} = hapi

const options = {
  parent: join(__dirname, 'controllers'),
  routes: controllers.index,
  controllers: controllers,
  module: module
}

config.database = false
config.queue = false

module.exports = hapiServer(options, new Runtime(config))
