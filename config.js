/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true, esversion: 6 */

const url = require('url')

const services = {
  ledger: {
    portno: 3001,

    f: () => {
      module.exports.wallet.settlementAddress =
      { BAT : process.env.BAT_SETTLEMENT_ADDRESS                || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6'
      }

      if (process.env.COINBASE_WIDGET_CODE) {
        module.exports.wallet.coinbase = { widgetCode : process.env.COINBASE_WIDGET_CODE }
      }

      if (process.env.REDEEMER_URL) {
        module.exports.redeemer =
        { url               : process.env.REDEEMER_URL   || 'http://127.0.0.1:3004'
        , access_token      : process.env.REDEEMER_TOKEN || '00000000-0000-4000-0000-000000000000'
        }
      }
      if (process.env.REDEEMER_CARD_ID) {
        module.exports.redeemer =
        { cardId               : process.env.REDEEMER_CARD_ID
        }
      }
      if (process.env.BALANCE_URL) {
        module.exports.balance =
          { url                 : process.env.BALANCE_URL    || 'http://127.0.0.1:3000'
          , access_token        : process.env.BALANCE_TOKEN  || '00000000-0000-4000-0000-000000000000'
          }
      }
      if (process.env.SIMPLEX_URL) {
        module.exports.simplex =
          { url                 : process.env.SIMPLEX_URL
          , api_key             : process.env.SIMPLEX_API_KEY
          }
      }

      helper()
      uphold()
    }
  },
  
  eyeshade: {
    portno: 3002,

    f: () => {
      if (process.env.PUBLISHERS_URL) {
        module.exports.publishers =
          { url                 : process.env.PUBLISHERS_URL    || 'http://127.0.0.1:3000'
          , access_token        : process.env.PUBLISHERS_TOKEN  || '00000000-0000-4000-0000-000000000000'
          }
      }

      helper()
      uphold()
    }
  },

  balance: {
    portno: 3003,

    f: () => {
      if (process.env.LEDGER_URL) {
        module.exports.ledger = { url : process.env.LEDGER_URL  || 'http://127.0.0.1:3001' }
      }

      helper()
      uphold()
    }
  },

  helper: {
    portno: 3004
  },

  collector: {
    portno: 3005,

    f: () => {
      module.exports.gather = { site: {} }
      if (process.env.YOUTUBE_API_KEY) {
        module.exports.gather.youtube =
          { url                 : process.env.YOUTUBE_URL       || 'https://www.googleapis.com/youtube/v3/channels'
          , api_key             : process.env.YOUTUBE_API_KEY
          }
      }

      helper()
      mongo2()
    }
  },

  extractor: {
    portno: 3006,

    f: () => {
      if (!process.env.POSTGRES_URI) {
        parts = {
          protocol: 'postgresql:',
          slashes: true,
          auth: process.env.PGUSER                              || process.env.USER,
          port: process.env.PGPORT                              ||'5432',
          hostname: process.env.PGHOST                          || '127.0.0.1',
          pathname: process.env.PGDATABASE                      || '/test_extractor',
          query: {
            sslmode: process.env.PGSSLMODE                      || 'require',
            ssl: true
          }
        }
        if (parts.auth && process.env.PGPASSWORD) parts.auth += ':' + process.env.PGPASSWORD
        parts.host = parts.hostname + ':' + parts.port
        parts.path = parts.pathname
        process.env.POSTGRES_URI = url.format(parts)
      }
      module.exports.sql = { postgres: { connectionString: process.env.POSTGRES_URI } }

      if (process.env.PAPERTRAIL_API_TOKEN) module.exports.papertrail = { accessToken: process.env.PAPERTRAIL_API_TOKEN }
      helper()
      mongo2()
    }
  }
}

const helper = () => {
  if (!process.env.HELPER_URL) return
  
  module.exports.currency.helper =
  { url               : process.env.HELPER_URL
  , access_token      : process.env.HELPER_TOKEN                || '00000000-0000-4000-0000-000000000000'
  }
}

const mongo2 = () => {
  if (process.env.MONGODB2_URI) {
    module.exports.database.mongo2 = process.env.MONGODB2_URI
    const parts = url.parse(module.exports.database.mongo2, true)

    if (!parts.query) parts.query = {}
    if (!parts.query.readOnly) {
      parts.query.readOnly = true
      parts.query.readPreference = 'secondary'
      module.exports.database.mongo2 = url.format(parts)
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
if (!service) throw new Error('invalid process.env.SERVICE=' + process.env.SERVICE)

process.env.PORT = process.env.PORT  || service.portno

const SERVICE = process.env.SERVICE.toUpperCase()
new Array('MONGODB_URI', 'MONGODB2_URI', 'POSTGRES_URI',
          'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
          'PAPERTRAIL_API_TOKEN',
          'SLACK_CHANNEL', 'SLACK_ICON_URL', 'SLACK_WEBOOK').forEach((v) => {
  const value = process.env[v]  || process.env[SERVICE + '_' + v]

  if (typeof value !== 'undefined') process.env[v] = value
})

module.exports =
{ altcurrency           : process.env.ALTCURRENCY               || 'BAT'
, cache                 :
  { redis               : process.env.REDIS_URL                 || 'redis://localhost:6379' }
, currency              :
  { altcoins            : process.env.CRYPTO_CURRENCIES ? process.env.CRYPTO_CURRENCIES.split(',')
                                                        : [ 'BAT', 'BTC', 'ETH', 'LTC' ] }
, database              :
  { mongo               : process.env.MONGODB_URI               || 'localhost/test' }
, login                 : { github: false }
, queue                 :
  { rsmq                : process.env.REDIS_URL                 || 'redis://localhost:6379' }
, sentry                : { dsn: process.env.SENTRY_DSN         || false }
, newrelic              : { key: process.env.NEW_RELIC_LICENSE_KEY
                                                                || false }
, wallet                : { }

, testingCohorts        : process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : []
}
if (service.f) service.f()

if (process.env.NODE_ENV === 'production') {
  module.exports.server = url.parse('https://' + process.env.HOST)
} else {
  module.exports.server = url.parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
}

if (process.env.OXR_APP_ID) {
  module.exports.currency.oxr =
  { apiID             : process.env.OXR_APP_ID
  , cacheTTL          : process.env.OXR_CACHE_TTL
  }
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
