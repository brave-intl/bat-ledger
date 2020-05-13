require('dotenv').config()
if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-extras.worker'
}
const { Runtime, hapi } = require('bat-utils')
const { controllers, server } = hapi

const config = require('../config.js')

const accountsController = require('./controllers/accounts')
const publishersController = require('./controllers/publishers')
const referralsController = require('./controllers/referrals')
const statsController = require('./controllers/stats')
const snapshotsController = require('./controllers/snapshots')

Runtime.newrelic.setupNewrelic(config, __filename)

const parentModules = [
  accountsController,
  publishersController,
  referralsController,
  statsController,
  snapshotsController
]

const options = {
  port: process.env.PORT,
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
