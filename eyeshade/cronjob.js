import dotenv from 'dotenv'
import utils from 'bat-utils'
import config from '../config.js'
import reports from './workers/reports.js'

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
