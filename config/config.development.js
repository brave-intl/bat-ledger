if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development'
if (!process.env.PORT) process.env.PORT = 3002
process.env.FIXIE_URL = 'http://fixie:Bjjiz3ivFBt0EFp@velodrome.usefixie.com:80'
process.env.TOKEN_LIST = '00000000-0000-4000-0000-000000000000'

module.exports =
{ server                : require('url').parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
, altcurrency           : 'BTC'
, database              :
  { mongo               : process.env.MONGODB_URI          || 'localhost/test_eyeshade' }
, queue                 :
  { rsmq                : process.env.REDIS_URL            || 'redis://localhost:6379' }
, currency              :
  { altcoins            : [ 'BAT', 'BTC', 'ETH' ]
  , bitcoin_average     :
    { publicKey         : 'NjQyNjgyYWFkNWY0NDQ1M2JhMGNjMjFhZDVhYWZlMmQ'
    , secretKey         : 'ZDk0ODQzMWU4NzY3NGU3NmFhZGU1NTRhMmFmMjhmMjMxZTFmMGNiMGM2ODQ0MTliYjdiNmY3YTZjMGQ3NjEwZg'
    }
  }
, publishersX           :
  { url                 : 'http://127.0.0.1:3005'
  , access_token        : '00000000-0000-4000-0000-000000000000'
  }
, publishers            :
  { url                 : 'https://publishers.brave.com'
  , access_token        : '44498cbb2e53f4c420b0c335db79f44c1b3fdda47f3db5a3e4ca4978854cc154'
  }
, slack                 :
  { webhook             : 'https://hooks.slack.com/services/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'
  , channel             : '#eyeshade-bot'
  , icon_url            : 'https://eyeshade.brave.com/favicon.png'
  }
, login                 :
  { organization        : 'brave'
  , world               : '/documentation'
  , bye                 : 'https://brave.com'
  , clientId            : process.env.GITHUB_CLIENT_ID     || '598f87a6b72fd7a5e8ed'
  , clientSecret        : process.env.GITHUB_CLIENT_SECRET || '3f09b5fa567bf1510a58660c8083bd76a178fbb0'
  , ironKey             : process.env.IRON_KEYPASS         || 'cookie-encryption-password-at-least-32-octets'
  , isSecure            : process.env.GITHUB_FORCE_HTTPS   || false
  }
}
