const agent = require('supertest').agent
const mongodb = require('mongodb')
const stringify = require('querystring').stringify
const _ = require('underscore')
const uuid = require('uuid')
const redis = require('redis')

const braveYoutubeOwner = 'publishers#uuid:' + uuid.v4().toLowerCase()
const braveYoutubePublisher = `youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg`

const eyeshadeCollections = [
  'grants',
  'owners',
  'restricted',
  'publishers',
  'tokens',
  'referrals',
  'surveyors',
  'settlements'
]
const ledgerCollections = [
  'owners',
  'referrals',
  'publishers',
  'tokens',
  'grants',
  'surveyors',
  'settlements',
  'publishersV2',
  'publishersX',
  'restricted'
]

const tkn = process.env.TOKEN_LIST.split(',')[0]
const token = `Bearer ${tkn}`

const uint8tohex = (arr) => {
  var strBuilder = []
  arr.forEach(function (b) { strBuilder.push(('00' + b.toString(16)).substr(-2)) })
  return strBuilder.join('')
}

const createFormURL = (params) => (pathname, p) => `${pathname}?${stringify(_.extend({}, params, p || {}))}`

const formURL = createFormURL({
  format: 'json',
  summary: true,
  balance: true,
  verified: true,
  amount: 0,
  currency: 'USD'
})

const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))

const eyeshadeAgent = agent(process.env.BAT_EYESHADE_SERVER).set('Authorization', token)
const ledgerAgent = agent(process.env.BAT_LEDGER_SERVER).set('Authorization', token)

const ok = (res) => {
  const { status, body } = res
  if (status !== 200) {
    return new Error(JSON.stringify(body, null, 2).replace(/\\n/g, '\n'))
  }
}

// write an abstraction for the do while loops
const tryAfterMany = async (ms, theDoBlock, theCatchBlock) => {
  let tryagain = null
  let result = null
  do {
    tryagain = false
    try {
      result = await theDoBlock()
      tryagain = theCatchBlock(null, result)
    } catch (e) {
      tryagain = theCatchBlock(e, result)
    }
    if (tryagain) {
      await timeout(ms)
    }
  } while (tryagain)
  return result
}

const fetchReport = async ({ url, isCSV }) => {
  return tryAfterMany(5000,
    () => agent('').get(url).send(),
    (e, result) => {
      if (e) {
        throw e
      }
      const { statusCode, headers } = result
      if (isCSV) {
        return headers['content-type'].indexOf('text/csv') === -1
      }
      if (statusCode < 400) {
        return false
      }
      const tryagain = statusCode === 404
      if (!tryagain) {
        throw result
      }
      return tryagain
    })
}

/**
 * assert that values v1 and v2 differ by no more than tol
 **/
const assertWithinBounds = (t, v1, v2, tol, msg) => {
  if (v1 > v2) {
    t.true((v1 - v2) <= tol, msg)
  } else {
    t.true((v2 - v1) <= tol, msg)
  }
}

const connectToDb = async (key) => {
  const dbUri = `${process.env.BAT_MONGODB_URI}/${key}`
  return mongodb.MongoClient.connect(dbUri)
}

const cleanDb = async (key, collections) => {
  const db = await connectToDb(key)
  await db.dropDatabase()
  return db
}
const cleanLedgerDb = async (collections) => {
  return cleanDb('ledger', collections || ledgerCollections)
}
const cleanEyeshadeDb = async (collections) => {
  return cleanDb('eyeshade', collections || eyeshadeCollections)
}

const cleanRedisDb = async () => {
  const host = process.env.GRANT_REDIS_HOST || 'localhost'
  const client = redis.createClient({
    host
  })
  await new Promise((resolve, reject) => {
    client.on('ready', () => {
      client.flushdb((err) => {
        err ? reject(err) : resolve()
      })
    }).on('error', (err) => reject(err))
  })
}

module.exports = {
  uint8tohex,
  fetchReport,
  formURL,
  ok,
  timeout,
  eyeshadeAgent,
  ledgerAgent,
  assertWithinBounds,
  connectToDb,
  cleanDb,
  cleanLedgerDb,
  cleanEyeshadeDb,
  cleanRedisDb,
  braveYoutubeOwner,
  braveYoutubePublisher
}
