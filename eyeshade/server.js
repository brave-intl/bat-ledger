require('dotenv').config()
if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-extras.worker'
}
const { Runtime, hapi } = require('bat-utils')
const { controllers, server } = hapi

const config = require('../config.js')

const addressController = require('./controllers/address')
const grafanaDatasourceController = require('./controllers/grafana-datasource')
const ownersController = require('./controllers/owners')
const publishersController = require('./controllers/publishers')
const ratesController = require('./controllers/rates')
const referralsController = require('./controllers/referrals')
const reportsController = require('./controllers/reports')
const walletController = require('./controllers/wallet')

Runtime.newrelic.setupNewrelic(config, __filename)

const parentModules = [
  addressController,
  grafanaDatasourceController,
  ownersController,
  publishersController,
  ratesController,
  referralsController,
  reportsController,
  walletController
]

const options = {
  parentModules,
  routes: controllers.index,
  controllers: controllers,
  module: module,
  headersP: false,
  remoteP: true
}

config.cache = false
config.postgres.schemaVersion = require('./migrations/current')

module.exports = server(options, new Runtime(config))
