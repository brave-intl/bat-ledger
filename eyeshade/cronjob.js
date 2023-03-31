import dotenv from 'dotenv'
import * as utils from 'bat-utils'
import config from '../config.js'
import * as reports from './workers/reports.js'
import { fileURLToPath } from 'url'
import { getCurrent } from './migrations/current.js'

const {
  Runtime
} = utils

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false
config.database = false
config.prometheus = false
config.kafka = false
config.postgres.schemaVersion = getCurrent

const runtime = new Runtime(config)

main()

async function main () {
  await reports.runFreezeOldSurveyors(reports.debug, runtime)
  await runtime.quit()
}
