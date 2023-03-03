import * as utils from 'bat-utils/index.js'
import * as config from '../config.js'
import * as suggestionsConsumer from './workers/suggestions.js'
import * as voteConsumer from './workers/acvote.js'
import * as referralsConsumer from './workers/referrals.js'
import * as settlementsConsumer from './workers/settlements.js'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

const extras = utils.extras
const Runtime = utils.Runtime

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
export default runtime
