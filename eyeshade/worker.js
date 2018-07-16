const dotenv = require('dotenv')
const { join } = require('path')
const utils = require('bat-utils')

const config = require('../config.js')

const {
  Runtime,
  extras
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

const options = {
  parent: join(__dirname, 'workers'),
  module: module
}

config.cache = false
config.postgres.schemaVersion = require('./migrations/current')

extras.worker(options, new Runtime(config))
