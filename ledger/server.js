require('dotenv').config()
if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-extras.worker'
}
const { Runtime, hapi } = require('bat-utils')
const { controllers, server } = hapi

const addressController = require('./controllers/address')
const grantsController = require('./controllers/grants')
const providerController = require('./controllers/provider')
const publisherController = require('./controllers/publisher')
const ratesController = require('./controllers/rates')
const registrarController = require('./controllers/registrar')
const reportsController = require('./controllers/reports')
const surveyorController = require('./controllers/surveyor')
const walletController = require('./controllers/wallet')

const config = require('../config.js')

const parentModules = [
  addressController,
  grantsController,
  providerController,
  publisherController,
  ratesController,
  registrarController,
  reportsController,
  surveyorController,
  walletController
]

Runtime.newrelic.setupNewrelic(config, __filename)

const options = {
  parentModules,
  routes: controllers.index,
  controllers: controllers,
  module: module,
  headersP: false,
  remoteP: false
}

config.cache = false

module.exports = server(options, new Runtime(config))
