const agent = require('supertest').agent
const mongodb = require('mongodb')
const stringify = require('querystring').stringify
const _ = require('underscore')
const uuid = require('uuid')

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

const status = (expectation) => ({ status, body }) => {
  if (status !== expectation) {
    return new Error(JSON.stringify(body, null, 2).replace(/\\n/g, '\n'))
  }
}

const ok = (res) => status(200)(res)

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
  }))
}

const connectEyeshadeDb = async (t) => {
  const dbUri = `${process.env.BAT_MONGODB_URI}/eyeshade`
  t.context.db = await mongodb.MongoClient.connect(dbUri)
}

const cleanEyeshadeDb = async (t) => {
  const collections = ['owners', 'publishers', 'tokens']
  const db = t.context.db
  await forEachCollection(db, collections, removeCollection)
  await forEachCollection(db, collections, (collection, name) => {
    t.context[name] = collection
  })
}

module.exports = {
  uint8tohex,
  fetchReport,
  formURL,
  ok,
  status,
  timeout,
  eyeshadeAgent,
  ledgerAgent,
  assertWithinBounds,
  connectEyeshadeDb,
  cleanEyeshadeDb,
  braveYoutubeOwner,
  braveYoutubePublisher
}
