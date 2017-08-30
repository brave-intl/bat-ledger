if (!process.env.PORT) process.env.PORT = 3001

module.exports =
{ server                : require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
, altcurrency           : 'BTC'
, database              :
  { mongo               : process.env.MONGODB_URI          || 'localhost/test' }
, queue                 :
  { rsmq                : process.env.REDIS_URL            || 'localhost:6379' }
, currency              :
  { altcoins            : process.env.CRYPTO_CURRENCIES.split(',')
  , bitcoin_average     :
    { publicKey         : process.env.BITCOIN_AVERAGE_PUBLIC_KEY
    , secretKey         : process.env.BITCOIN_AVERAGE_SECRET_KEY
    }
  }
, wallet                :
  { bitgo               :
    { accessToken       : process.env.BITGO_TOKEN
    , enterpriseId      : process.env.BITGO_ENTERPRISE_ID
    , environment       : process.env.BITGO_ENVIRONMENT
    , settlementAddress : process.env.BITGO_SETTLEMENT_ADDRESS
    , unspendableXpub   : process.env.BITGO_UNSPENDABLE_XPUB
    }
  , coinbase            :
    { widgetCode        : process.env.COINBASE_WIDGET_CODE }
  }
, publishers            :
  { url                 : process.env.PUBLISHERS_URL
  , access_token        : process.env.PUBLISHERS_TOKEN
  }
, slack                 :
  { webhook             : process.env.SLACK_WEBHOOK
  , channel             : process.env.SLACK_CHANNEL
  , icon_url            : process.env.SLACK_ICON_URL
  }
, login                 :
  { organization        : ''
  , world               : '/documentation'
  , bye                 : 'https://example.com'
  , clientId            : process.env.GITHUB_CLIENT_ID
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET
  , ironKey             : process.env.IRON_KEYPASS
  , isSecure            : process.env.GITHUB_FORCE_HTTPS   || false
  }
}
