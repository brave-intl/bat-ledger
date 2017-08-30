if (process.env.SERVICE === 'bat-eyeshade') {
  process.env.PORT = process.env.PORT || 3002
  process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || process.env.EYESHADE_GITHUB_CLIENT_ID
  process.env.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || process.env.EYESHADE_GITHUB_CLIENT_SECRET 
} else {
  process.env.PORT = process.env.PORT || 3001
  process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || process.env.LEDGER_GITHUB_CLIENT_ID
  process.env.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || process.env.LEDGER_GITHUB_CLIENT_SECRET 
}

module.exports =
{ altcurrency           : process.env.ALTCURRENCY || 'BTC'
, database              :
  { mongo               : process.env.MONGODB_URI          || 'localhost/test' }
, queue                 :
  { rsmq                : process.env.REDIS_URL            || 'localhost:6379' }
, currency              :
  { altcoins            : process.env.CRYPTO_CURRENCIES ? process.env.CRYPTO_CURRENCIES.split(',') : ['BAT', 'BTC', 'ETH'] }
}

if (process.env.NODE_ENV === 'production') {
  module.exports.server = require('url').parse('https://' + process.env.HOST)
} else {
  module.exports.server = require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
}

if (process.env.BITCOIN_AVERAGE_PUBLIC_KEY) {
  module.exports.currency.bitcoin_average =
    { publicKey         : process.env.BITCOIN_AVERAGE_PUBLIC_KEY
    , secretKey         : process.env.BITCOIN_AVERAGE_SECRET_KEY
    }
}

if (process.env.BITGO_TOKEN || process.env.COINBASE_WIDGET_CODE) {
  module.exports.wallet = { }
}

if (process.env.SERVICE !== 'bat-eyeshade') {
  if (process.env.BITGO_TOKEN) {
    module.exports.wallet.bitgo =
    { accessToken       : process.env.BITGO_TOKEN
    , enterpriseId      : process.env.BITGO_ENTERPRISE_ID
    , environment       : process.env.BITGO_ENVIRONMENT
    , settlementAddress : process.env.BITGO_SETTLEMENT_ADDRESS
    , unspendableXpub   : process.env.BITGO_UNSPENDABLE_XPUB
    }
  }
  if (process.env.COINBASE_WIDGET_CODE) {
    module.exports.wallet.coinbase =
    { widgetCode        : process.env.COINBASE_WIDGET_CODE }
  }
}

if (process.env.SERVICE === 'bat-eyeshade' && process.env.PUBLISHERS_URL) {
  module.exports.publishers =
  { url                 : process.env.PUBLISHERS_URL || 'http://127.0.0.1:3000'
  , access_token        : process.env.PUBLISHERS_TOKEN || '00000000-0000-4000-0000-000000000000'
  }
}

if (process.env.SLACK_WEBHOOK) {
  module.exports.slack =
  { webhook             : process.env.SLACK_WEBHOOK
  , channel             : process.env.SLACK_CHANNEL
  , icon_url            : process.env.SLACK_ICON_URL
  }
}

if (process.env.GITHUB_ORG) {
  module.exports.login =
  { organization        : process.env.GITHUB_ORG
  , world               : process.env.GITHUB_LOGIN_WORLD || '/documentation'
  , bye                 : process.env.GITHUB_LOGIN_BYE || 'https://example.com'
  , clientId            : process.env.GITHUB_CLIENT_ID
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET
  , ironKey             : process.env.IRON_KEYPASS || 'cookie-encryption-password-at-least-32-octets'
  , isSecure            : process.env.GITHUB_FORCE_HTTPS   || false
  }
}
