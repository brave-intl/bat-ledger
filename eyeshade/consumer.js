const dotenv = require('dotenv')
const fs = require('fs')
const utils = require('bat-utils')

const config = require('../config.js')

const suggestionsConsumer = require('./workers/suggestions')
const voteConsumer = require('./workers/acvote')

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

let kafkaSslCertificate = process.env.KAFKA_SSL_CERTIFICATE
const kafkaSslCertificateLocation = process.env.KAFKA_SSL_CERTIFICATE_LOCATION
let kafkaSslKey = process.env.KAFKA_SSL_KEY
const kafkaSslKeyLocation = process.env.KAFKA_SSL_KEY_LOCATION

if (kafkaSslCertificate) {
  if (kafkaSslCertificateLocation && !fs.existsSync(kafkaSslCertificateLocation)) {
    if (kafkaSslCertificate[0] === '{') {
      const tmp = JSON.parse(kafkaSslCertificate)
      kafkaSslCertificate = tmp.certificate
      kafkaSslKey = tmp.key
    }
    fs.writeFileSync(kafkaSslCertificateLocation, kafkaSslCertificate)
  }
}

if (kafkaSslKey) {
  if (kafkaSslKeyLocation && !fs.existsSync(kafkaSslKeyLocation)) {
    fs.writeFileSync(kafkaSslKeyLocation, kafkaSslKey)
  }
}

suggestionsConsumer(runtime)
voteConsumer(runtime)
runtime.kafka.consume()
