const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const suggestionsConsumer = require('./workers/suggestions')

const {
  Runtime
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false
config.postgres.schemaVersion = require('./migrations/current')

const runtime = new Runtime(config)

suggestionsConsumer(runtime)
runtime.kafka.consume()
