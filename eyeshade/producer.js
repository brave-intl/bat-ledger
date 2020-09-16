const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const { producer: referralsProducer } = require('./workers/referrals')
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
config.queue = false
config.prometheus = false
config.postgres.schemaVersion = require('./migrations/current')

const runtime = new Runtime(config)

extras.utils.setupKafkaCert()

referralsProducer(runtime)
