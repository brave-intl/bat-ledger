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
config.currency = false
config.database = false
config.queue = false
config.prometheus = false
config.postgres.schemaVersion = require('./migrations/current')

const runtime = new Runtime(config)

const kafkaSslCertificate = process.env.KAFKA_SSL_CERTIFICATE
const kafkaSslCertificateLocation = process.env.KAFKA_SSL_CERTIFICATE_LOCATION

if (kafkaSslCertificate) {
  if (kafkaSslCertificateLocation && !fs.existsSync(kafkaSslCertificateLocation)) {
    fs.writeFileSync(kafkaSslCertificateLocation, kafkaSslCertificate)
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
