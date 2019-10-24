const fs = require('fs')
const { sign } = require('http-request-signature')
const crypto = require('crypto')
const path = require('path')
const dotenv = require('dotenv')
dotenv.config()
const agent = require('supertest').agent
const mongodb = require('mongodb')
const stringify = require('querystring').stringify
const _ = require('underscore')
const uuidV4 = require('uuid/v4')
const redis = require('redis')
const BigNumber = require('bignumber.js')
const {
  timeout,
  uint8tohex
} = require('bat-utils/lib/extras-utils')
const SDebug = require('sdebug')
const debug = new SDebug('test')
const pg = require('pg')

const Pool = pg.Pool

const braveYoutubeOwner = 'publishers#uuid:' + uuidV4().toLowerCase()
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
  'wallets',
  'surveyors',
  'settlements',
  'publishersV2',
  'publishersX',
  'restricted'
]

const tkn = process.env.TOKEN_LIST.split(',')[0]
const token = `Bearer ${tkn}`

const createFormURL = (params) => (pathname, p) => `${pathname}?${stringify(_.extend({}, params, p || {}))}`

const formURL = createFormURL({
  format: 'json',
  summary: true,
  balance: true,
  verified: true,
  amount: 0,
  currency: 'USD'
})

const AUTH_KEY = 'Authorization'
const eyeshadeAgent = agent(process.env.BAT_EYESHADE_SERVER).set(AUTH_KEY, token)
const ledgerAgent = agent(process.env.BAT_LEDGER_SERVER).set(AUTH_KEY, token)
const balanceAgent = agent(process.env.BAT_BALANCE_SERVER).set(AUTH_KEY, token)
const grantAgent = agent(process.env.BAT_GRANT_SERVER).set(AUTH_KEY, token)

const status = (expectation) => (res) => {
  if (!res) {
    return new Error('no response object given')
  }
  const { status, body, request } = res
  if (status !== expectation) {
    const { url, method } = request
    return new Error(JSON.stringify({
      method,
      url,
      expectation,
      status,
      body
    }, null, 2).replace(/\\n/g, '\n'))
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
const dbUri = (db) => `${process.env.BAT_MONGODB_URI}/${db}`
const connectToDb = async (key) => {
  const client = await mongodb.MongoClient.connect(dbUri(key), {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  return client.db(key)
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

const cleanGrantDb = async () => {
  const url = process.env.BAT_GRANT_POSTGRES_URL
  const pool = new Pool({ connectionString: url, ssl: false })
  const client = await pool.connect()
  try {
    await Promise.all([
      client.query('DELETE from claim_creds;'),
      client.query('DELETE from claims;'),
      client.query('DELETE from wallets;'),
      client.query('DELETE from promotions;'),
    ])
  } finally {
    client.release()
  }
}

module.exports = {
  readJSONFile,
  makeSettlement,
  insertReferralInfos,
  createSurveyor,
  getSurveyor,
  fetchReport,
  formURL,
  ok,
  debug,
  status,
  eyeshadeAgent,
  grantAgent,
  ledgerAgent,
  balanceAgent,
  assertWithinBounds,
  connectToDb,
  dbUri,
  cleanDb,
  cleanDbs,
  cleanPgDb,
  cleanLedgerDb,
  cleanEyeshadeDb,
  cleanGrantDb,
  braveYoutubeOwner,
  braveYoutubePublisher,
  setupCreatePayload,
  statsUrl
}

function cleanDbs () {
  return Promise.all([
    cleanEyeshadeDb(),
    cleanLedgerDb(),
    cleanGrantDb()
  ])
}

function cleanPgDb (postgres) {
  return async () => {
    const client = await postgres.connect()
    try {
      await Promise.all([
        client.query('DELETE from payout_reports_ads;'),
        client.query('DELETE from potential_payments_ads;'),
        client.query('DELETE from transactions;'),
        client.query('DELETE from surveyor_groups;'),
        client.query('DELETE from geo_referral_countries;'),
        client.query('DELETE from geo_referral_groups;'),
        client.query('DELETE from votes;')
      ])
      await client.query('REFRESH MATERIALIZED VIEW account_balances;')
      await insertReferralInfos(client)
    } finally {
      client.release()
    }
  }
}

function getSurveyor (id) {
  return ledgerAgent
    .get(`/v2/surveyor/contribution/${id || 'current'}`)
    .expect(ok)
}

function createSurveyor (options = {}) {
  const {
    votes = 1,
    rate = 1,
    // probi is optional
    probi
  } = options
  const url = '/v2/surveyor/contribution'
  const data = {
    adFree: {
      fee: { USD: 5 },
      votes,
      altcurrency: 'BAT',
      probi: probi || new BigNumber(votes * rate).times('1e18').toString()
    }
  }
  return ledgerAgent.post(url).send(data).expect(ok)
}

function setupCreatePayload ({
  surveyorId,
  viewingId,
  keypair
}) {
  return (unsignedTx) => {
    const octets = JSON.stringify(unsignedTx)
    const headers = {
      digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
    }
    headers['signature'] = sign({
      headers: headers,
      keyId: 'primary',
      secretKey: uint8tohex(keypair.secretKey)
    }, {
      algorithm: 'ed25519'
    })
    return {
      requestType: 'httpSignature',
      signedTx: {
        headers: headers,
        octets: octets
      },
      surveyorId: surveyorId,
      viewingId: viewingId
    }
  }
}

function statsUrl () {
  const dateObj = new Date()
  const dateISO = dateObj.toISOString()
  const date = dateISO.split('T')[0]
  const dateObj2 = new Date(date)
  const DAY = 1000 * 60 * 60 * 24
  // two days just in case this happens at midnight
  // and the tests occur just after
  const dateFuture = new Date(+dateObj2 + (2 * DAY))
  const futureISO = dateFuture.toISOString()
  const future = futureISO.split('T')[0]
  return `/v2/wallet/stats/${date}/${future}`
}

function makeSettlement (type, balance, overwrites = {}) {
  const amount = new BigNumber(balance).times(1e18)
  const fees = amount.times(0.05)
  const probi = amount.times(0.95)
  return Object.assign({
    type,
    currency: 'USD',
    altcurrency: 'BAT',
    fees: fees.toString(),
    probi: probi.toString(),
    amount: amount.dividedBy(1e18).toString(),
    publisher: braveYoutubePublisher,
    owner: braveYoutubeOwner,
    transactionId: uuidV4(),
    address: uuidV4(),
    hash: uuidV4()
  }, overwrites)
}

async function insertReferralInfos (client) {
  const ratesPaths = [{
    path: filePath('0010_geo_referral', 'seeds', 'groups.sql')
  }, {
    path: filePath('0010_geo_referral', 'seeds', 'countries.sql')
  }]
  for (const { path } of ratesPaths) {
    await client.query(fs.readFileSync(path).toString())
  }

  function filePath (...paths) {
    return path.join(__dirname, '..', 'eyeshade', 'migrations', ...paths)
  }
}

function readJSONFile (...paths) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ...paths)).toString())
}
