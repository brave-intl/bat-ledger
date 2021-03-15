const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const suggestionsConsumer = require('./workers/suggestions')
const voteConsumer = require('./workers/acvote')
const { consumer: referralsConsumer } = require('./workers/referrals')
const { consumer: settlementsConsumer } = require('./workers/settlements')
const reports = require('./workers/reports')
const {
  extras,
  Runtime
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false
config.database = false
config.prometheus = false
config.postgres.schemaVersion = require('./migrations/current')

const runtime = new Runtime(config)

extras.utils.setupKafkaCert()

suggestionsConsumer(runtime)
voteConsumer(runtime)
referralsConsumer(runtime)
settlementsConsumer(runtime)
runtime.kafka.consume().catch(console.error)
reports.initialize(reports.debug, runtime)
module.exports = runtime
