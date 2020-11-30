/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true, esversion: 6 */

const services = {
  eyeshade: {
    portno: 3002,

    f: () => {
      module.exports.referrals =
        { currency              : process.env.REFERRALS_CURRENCY || 'USD'
        , amount                : process.env.REFERRALS_AMOUNT || 5
        }
      module.exports.postgres =
        { url                   : process.env.DATABASE_URL || 'postgres://localhost/test'
        , roURL                 : process.env.DATABASE_RO_URL || false
        , schemaVersion         : require('./eyeshade/migrations/current')
        , schemaVersionCheck    : true
        }

      uphold()
    }
  }
}

const uphold = () => {
  if ((!process.env.UPHOLD_ACCESS_TOKEN) && (!process.env.UPHOLD_CLIENT_ID)) return

  module.exports.wallet.uphold =
  { accessToken       : process.env.UPHOLD_ACCESS_TOKEN         || 'none'
  , clientId          : process.env.UPHOLD_CLIENT_ID            || 'none'
  , clientSecret      : process.env.UPHOLD_CLIENT_SECRET        || 'none'
  , environment       : process.env.UPHOLD_ENVIRONMENT          || 'sandbox'
  }
}


const service = services[process.env.SERVICE]
if (!service) {
  throw new Error('invalid process.env.SERVICE=' + process.env.SERVICE)
}

process.env.PORT = process.env.PORT  || service.portno

const SERVICE = process.env.SERVICE.toUpperCase()
new Array('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SLACK_CHANNEL', 'SLACK_ICON_URL').forEach((v) => {
  process.env[v] = process.env[v]  || process.env[SERVICE + '_' + v]
})

module.exports =
{
  // wreck: {
  //   rewards: {
  //     baseUrl: process.env.REWARD_SERVER,
  //     headers: {
  //       'Content-Type': 'application/json'
  //     }
  //   }
  // },
  altcurrency           : process.env.ALTCURRENCY               || 'BAT'
, cache                 :
  { redis               :
    { url               : process.env.REDIS_URL                 || 'redis://localhost:6379' }
  }
, currency              :
  { altcoins            : process.env.CRYPTO_CURRENCIES ? process.env.CRYPTO_CURRENCIES.split(',')
                                                        : [ 'BAT', 'BTC', 'ETH', 'LTC' ] }
, login                 : { github: false }
, sentry                :
  { dsn: process.env.SENTRY_DSN          || false
  , slug: process.env.HEROKU_SLUG_COMMIT || 'test'
  , project: process.env.HEROKU_APP_NAME  || process.env.SERVICE
  }
, newrelic              : { key: process.env.NEW_RELIC_LICENSE_KEY
                                                                || false }
, wallet                : { }

, testingCohorts        : process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : []
, currency:
  { url: process.env.BAT_RATIOS_URL || false
  , access_token: process.env.BAT_RATIOS_TOKEN || false
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
  { BAT : process.env.BAT_SETTLEMENT_ADDRESS                || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}

if (process.env.BAT_ADS_PAYOUT_ADDRESS) {
  module.exports.wallet.adsPayoutAddress =
  { BAT : process.env.BAT_ADS_PAYOUT_ADDRESS                || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}

if (process.env.SLACK_WEBHOOK) {
  module.exports.slack =
  { webhook             : process.env.SLACK_WEBHOOK
  , channel             : process.env.SLACK_CHANNEL             || '#bat-bot'
  , icon_url            : process.env.SLACK_ICON_URL            || 'https://github.com/brave-intl/bat-ledger/raw/master/documentation/favicon.png'
  }
}

if (process.env.GITHUB_ORG) {
  module.exports.login.github =
  { organization        : process.env.GITHUB_ORG
  , world               : process.env.GITHUB_LOGIN_WORLD        || '/documentation'
  , bye                 : process.env.GITHUB_LOGIN_BYE          || 'https://example.com'
  , clientId            : process.env.GITHUB_CLIENT_ID
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET
  , ironKey             : process.env.IRON_KEYPASS              || 'cookie-encryption-password-at-least-32-octets'
  , isSecure            : process.env.GITHUB_FORCE_HTTPS        || false
  }
}

if (process.env.KAFKA_BROKERS) {
  module.exports.kafka = {
    noptions:
    { 'metadata.broker.list': process.env.KAFKA_BROKERS
    , 'group.id': process.env.ENV + '.' + process.env.SERVICE
    , 'socket.keepalive.enable': true
    , 'api.version.request': true
    , 'socket.blocking.max.ms': 100
    , "security.protocol": "SSL"
    , "ssl.certificate.location": process.env.KAFKA_SSL_CERTIFICATE_LOCATION
    , "ssl.key.location": process.env.KAFKA_SSL_KEY_LOCATION
    },
    tconf:
    { 'request.required.acks': +process.env.KAFKA_REQUIRED_ACKS
    , 'auto.offset.reset': 'earliest'
    }
  }
  if (process.env.KAFKA_SSL_CA_LOCATION) {
    module.exports.kafka.noptions["ssl.ca.location"] = process.env.KAFKA_SSL_CA_LOCATION
  }
  if (process.env.KAFKA_SSL_KEY_PASSWORD) {
    module.exports.kafka.noptions["ssl.key.password"] = process.env.KAFKA_SSL_KEY_PASSWORD
  }
}

module.exports.prometheus =
  { label              : process.env.SERVICE + '.' + (process.env.DYNO || 1)
  , redis              : process.env.REDIS2_URL               || process.env.REDIS_URL               ||  false
  }
