if (!process.env.PORT) process.env.PORT = 3002

module.exports =
{ server                : require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
, database              :
  { mongo               : process.env.MONGODB_URI          || 'localhost/test' }
, queue                 :
  { rsmq                : process.env.REDIS_URL            || 'localhost:6379' }
, publishers            :
  { url                 : process.env.PUBLISHERS_URL
  , access_token        : process.env.PUBLISHERS_TOKEN
  }
}

if (process.env.CRYPTO_CURRENCIES) {
  module.exports.currency =
  { altcoins            : process.env.CRYPTO_CURRENCIES.split(',')
  , bitcoin_average     :
    { publicKey         : process.env.BITCOIN_AVERAGE_PUBLIC_KEY
    , secretKey         : process.env.BITCOIN_AVERAGE_SECRET_KEY
    }
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
  , world               : process.env.LOGIN_WORLD || '/documentation'
  , bye                 : process.env.LOGIN_BYE || 'https://example.com'
  , clientId            : process.env.GITHUB_CLIENT_ID
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET
  , ironKey             : process.env.IRON_KEYPASS
  , isSecure            : process.env.GITHUB_FORCE_HTTPS   || false
  }
}
