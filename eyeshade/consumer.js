const dotenv = require('dotenv')
const fs = require('fs')
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

const kafkaSslCa = process.env.KAFKA_SSL_CA
const kafkaSslCaLocation = process.env.KAFKA_SSL_CA_LOCATION

if (kafkaSslCa) {
  if (kafkaSslCaLocation && !fs.existsSync(kafkaSslCaLocation)) {
    fs.writeFileSync(kafkaSslCaLocation, kafkaSslCa)
  }
}

const kafkaSSlKey = process.env.KAFKA_SSL_KEY
const kafkaSSlKeyLocation = process.env.KAFKA_SSL_KEY_LOCATION

if (kafkaSSlKey) {
  if (kafkaSSlKeyLocation && !fs.existsSync(kafkaSSlKeyLocation)) {
    fs.writeFileSync(kafkaSSlKeyLocation, kafkaSSlKey)
  }
}

suggestionsConsumer(runtime)
runtime.kafka.consume()
