const dotenv = require('dotenv')
const config = require('../config.js')
const utils = require('../bat-utils')

const addressControllers = require('./controllers/address')

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

const parentModules = [
  addressControllers
]

const options = {
  port: process.env.PORT,
  parentModules,
  routes: controllers.index,
  controllers: controllers,
  module: module
}

config.database = false
config.queue = false

module.exports = hapiServer(options, new Runtime(config))
