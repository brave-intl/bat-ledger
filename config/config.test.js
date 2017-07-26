if (!process.env.PORT) process.env.PORT = 3001

module.exports =
{ server                : require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
, database              :
  { mongo               : process.env.MONGODB_URI          || 'localhost/test' }
, queue                 :
  { rsmq                : process.env.REDIS_URL            || 'localhost:6379' }
, wallet                :
  { bitgo               :
    { accessToken       : ''
    , enterpriseId      : ''
    , environment       : 'test'
    , refundAddress     : ''
    , settlementAddress : ''
    , unspendableXpub   : ''
    }
  , coinbase            :
    { widgetCode        : '' }
  , bitcoin_average     :
    { publicKey         : ''
    , secretKey         : ''
    }
  }
, payments              :
  { stripe              :
    { secretKey         : process.env.STRIPE_SECRET_KEY }
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
  , clientId            : process.env.GITHUB_CLIENT_ID     || '00000000000000000000'
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET || '0000000000000000000000000000000000000000'
  , ironKey             : process.env.IRON_KEYPASS
  , isSecure            : process.env.GITHUB_FORCE_HTTPS   || false
  }
}
