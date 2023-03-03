/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true, esversion: 6 */
import fs from 'fs'
import { getCurrent } from './eyeshade/migrations/current.js';
import url from 'url';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


let referrals;
let postgres;
let postgresRO;


const services = {
  eyeshade: {
    portno: 3002,

    f: () => {
      referrals =
      {
        currency: process.env.REFERRALS_CURRENCY || 'USD',
        amount: process.env.REFERRALS_AMOUNT || 5
      }
      postgres =
      {
        connectionString: process.env.DATABASE_URL || 'postgres://localhost/test',
        schemaVersion: getCurrent(),
        schemaVersionCheck: true,
        ssl: process.env.NODE_ENV === 'production' ? { ca: fs.readFileSync(process.env.RDS_CA_CERT_LOCATION).toString(), rejectUnauthorized: true } : false
      }
      postgresRO =
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

const altcurrency = process.env.ALTCURRENCY || 'BAT';
const publishers = {
    url                 : process.env.PUBLISHERS_URL,
    access_token        : process.env.PUBLISHERS_TOKEN
  };
const cache =
  {
    redis:
      { url: redisURL || 'redis://localhost:6379' }
  };
// const currency =
//   {
//     altcoins: process.env.CRYPTO_CURRENCIES ? process.env.CRYPTO_CURRENCIES.split(',')
//       : ['BAT', 'BTC', 'ETH', 'LTC']
//   };
const login =  { github: false };
const sentry =
  {
    dsn: process.env.SENTRY_DSN || false,
    slug: process.env.HEROKU_SLUG_COMMIT || 'test',
    project: process.env.HEROKU_APP_NAME || process.env.SERVICE
  };
 const newrelic = {
    key: process.env.NEW_RELIC_LICENSE_KEY ||
      false
  };
  // wallet: {},
 const testingCohorts = process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : [];
 const currency =
  {
    url: process.env.BAT_RATIOS_URL || false,
    access_token: process.env.BAT_RATIOS_TOKEN || false
  };


if (service.f) service.f()
let server;
if (process.env.NODE_ENV === 'production') {
  server = url.parse('https://' + process.env.HOST)
} else {
  server = url.parse('http://' + '127.0.0.1' + ':' + process.env.PORT)
}

let wallet = {};
if (process.env.BAT_SETTLEMENT_ADDRESS) {
  wallet.settlementAddress =
    { BAT: process.env.BAT_SETTLEMENT_ADDRESS || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}

if (process.env.BAT_ADS_PAYOUT_ADDRESS) {
  wallet.adsPayoutAddress =
    { BAT: process.env.BAT_ADS_PAYOUT_ADDRESS || '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' }
}
let kafka;
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

  kafka = { ...kafkaOptions }
}

const prometheus =
{
  label: process.env.SERVICE + '.' + (process.env.DYNO || 1),
  redis: redisURL || false
}


export {
  kafka,
  prometheus,
  server,
  wallet,
  altcurrency,
  publishers,
  currency,
  testingCohorts,
  newrelic,
  sentry,
  login,
  cache,
  service
}
