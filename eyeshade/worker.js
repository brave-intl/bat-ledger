const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const reportWorker = require('./workers/reports')
const {
  extras,
  Runtime
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

const runtime = new Runtime(config)

// call the report worker initialize
reportWorker(true, runtime)

module.exports = runtime
