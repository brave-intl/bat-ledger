const agent = require('supertest').agent
const mongodb = require('mongodb')
const stringify = require('querystring').stringify
const _ = require('underscore')
const uuid = require('uuid')
const redis = require('redis')

const braveYoutubeOwner = 'publishers#uuid:' + uuid.v4().toLowerCase()
const braveYoutubePublisher = `youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg`

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
const returnSelf = (collection) => collection
const removeCollection = (collection) => collection.remove()
const forEachCollection = async (db, collections, munge = returnSelf) => {
  return Promise.all(collections.map((name) => {
    return munge(db.collection(name), name)
  })).then(() => db)
}

const connectToDb = async (key) => {
  const dbUri = `${process.env.BAT_MONGODB_URI}/${key}`
  return mongodb.MongoClient.connect(dbUri)
}

const resetTestContext = async (collections, fn) => {
  const db = await cleanEyeshadeDb(collections)
  await forEachCollection(db, collections, fn)
}

const cleanDb = async (key, collections) => {
  return forEachCollection(await connectToDb(key), collections, removeCollection)
}
const cleanLedgerDb = async (collections) => cleanDb('admin', collections)
const cleanEyeshadeDb = async (collections) => cleanDb('eyeshade', collections)

const cleanRedisDb = async () => {
  const host = 'grant-redis'
  const client = redis.createClient({
    host
  })
  await new Promise((resolve, reject) => {
    client.on('ready', () => {
      console.log('ready')
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
  resetTestContext,
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
