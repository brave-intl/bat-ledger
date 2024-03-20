import extras from 'bat-utils/boot-extras.js'
import { Runtime } from 'bat-utils/boot-runtime.js'
import config from '../config.js'
import suggestionsConsumer from './workers/suggestions.js'
import voteConsumer from './workers/acvote.js'
import settlementsConsumer from './workers/settlements.js'
import { getCurrent } from './migrations/current.js'

import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
dotenv.config() // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false
config.database = false
config.prometheus = false
config.postgres.schemaVersion = getCurrent()

const runtime = new Runtime(config)

extras.utils.setupKafkaCert()
suggestionsConsumer(runtime)
voteConsumer(runtime)
settlementsConsumer(runtime)
runtime.kafka.consume().catch(console.error)
export default runtime
