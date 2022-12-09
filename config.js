/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true, esversion: 6 */
const fs = require('fs');

const services = {
  eyeshade: {
    portno: 3002,

    f: () => {
      module.exports.referrals =
      {
        currency: process.env.REFERRALS_CURRENCY || 'USD',
        amount: process.env.REFERRALS_AMOUNT || 5
      }
      module.exports.postgres =
      {
        connectionString: process.env.DATABASE_URL || 'postgres://localhost/test',
        schemaVersion: require('./eyeshade/migrations/current'),
        schemaVersionCheck: true,
        ssl: process.env.NODE_ENV === 'production' ? { ca: fs.readFileSync(process.env.RDS_CA_CERT_LOCATION).toString(), rejectUnauthorized: true } : false
      }
      module.exports.postgresRO =
      {
        connectionString: process.env.DATABASE_RO_URL || 'postgres://localhost/test',
        ssl: process.env.NODE_ENV === 'production' ? { ca: fs.readFileSync(process.env.RDS_CA_CERT_LOCATION).toString(), rejectUnauthorized: true } : false
      }
    }
  }
}

const service = services[process.env.SERVICE]
if (!service) {
  throw new Error('invalid process.env.SERVICE=' + process.env.SERVICE)
}

process.env.PORT = process.env.PORT || service.portno
const redisURL = process.env.REDIS_URL

if (!process.env.PUBLISHERS_URL) throw new Error("Need PUBLISHERS_URL");
if (!process.env.PUBLISHERS_TOKEN) throw new Error("Need PUBLISHERS_TOKEN");

module.exports =
{
  altcurrency: process.env.ALTCURRENCY || 'BAT',
  publishers: {
    url                 : process.env.PUBLISHERS_URL,
    access_token        : process.env.PUBLISHERS_TOKEN
  },
  cache:
  {
    redis:
      { url: redisURL || 'redis://localhost:6379' }
  },
  currency:
  {
    altcoins: process.env.CRYPTO_CURRENCIES ? process.env.CRYPTO_CURRENCIES.split(',')
      : ['BAT', 'BTC', 'ETH', 'LTC']
  },
  login: { github: false },
  sentry:
  {
    dsn: process.env.SENTRY_DSN || false,
    slug: process.env.HEROKU_SLUG_COMMIT || 'test',
    project: process.env.HEROKU_APP_NAME || process.env.SERVICE
  },
  newrelic: {
    key: process.env.NEW_RELIC_LICENSE_KEY ||
      false
  },
  wallet: {},
  testingCohorts: process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : [],
  currency:
  {
    url: process.env.BAT_RATIOS_URL || false,
    access_token: process.env.BAT_RATIOS_TOKEN || false
  }
}
if (service.f) service.f()

if (process.env.NODE_ENV === 'production') {
  module.exports.server = require('url').parse('https://' + process.env.HOST)
} else {
  module.exports.server = require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
}

if (process.env.BAT_SETTLEMENT_ADDRESS) {
  module.exports.wallet.settlementAddress =
    { BAT: process.env.BAT_SETTLEMENT_ADDRESS || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}

if (process.env.BAT_ADS_PAYOUT_ADDRESS) {
  module.exports.wallet.adsPayoutAddress =
    { BAT: process.env.BAT_ADS_PAYOUT_ADDRESS || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}

if (process.env.KAFKA_BROKERS) {
  const kafkaOptions = {
    brokers: process.env.KAFKA_BROKERS.split(','),
    clientId: process.env.ENV + '.' + process.env.SERVICE,
    acks: +process.env.KAFKA_REQUIRED_ACKS
  }

  kafkaOptions.ssl = {
    key: fs.readFileSync(process.env.KAFKA_SSL_KEY_LOCATION, 'utf-8'),
    cert: fs.readFileSync(process.env.KAFKA_SSL_CERTIFICATE_LOCATION, 'utf-8')
  }

  if (process.env.KAFKA_SSL_CA_LOCATION) {
    kafkaOptions.ssl.ca = [fs.readFileSync(process.env.KAFKA_SSL_CA_LOCATION, 'utf-8')]
  }

  if (process.env.KAFKA_SSL_KEY_PASSWORD) {
    kafkaOptions.ssl.passphrase = process.env.KAFKA_SSL_KEY_PASSWORD
  }

  module.exports.kafka = { ...kafkaOptions }
}

module.exports.prometheus =
{
  label: process.env.SERVICE + '.' + (process.env.DYNO || 1),
  redis: redisURL || false
}
