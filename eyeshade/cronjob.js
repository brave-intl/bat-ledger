const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const reports = require('./workers/reports')
const {
  Runtime
} = utils

dotenv.config()

Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false
config.database = false
config.prometheus = false
config.kafka = false
config.postgres.schemaVersion = require('./migrations/current')

const runtime = new Runtime(config)

main()

async function main () {
  await reports.runFreezeOldSurveyors(reports.debug, runtime)
  await runtime.quit()
}
