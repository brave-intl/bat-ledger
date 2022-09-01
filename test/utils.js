const fs = require('fs')
const { sign } = require('http-request-signature')
const crypto = require('crypto')
const path = require('path')
const dotenv = require('dotenv')
dotenv.config()
const agent = require('supertest').agent
const stringify = require('querystring').stringify
const _ = require('underscore')
const { v4: uuidV4 } = require('uuid')
const {
  timeout,
  BigNumber,
  uint8tohex
} = require('bat-utils/lib/extras-utils')
const Postgres = require('bat-utils/lib/runtime-postgres')
const SDebug = require('sdebug')
const debug = new SDebug('test')
const Server = require('bat-utils/lib/hapi-server')
const { Runtime } = require('bat-utils')

const {
  TOKEN_LIST,
  BAT_EYESHADE_SERVER,
  ALLOWED_REFERRALS_TOKENS,
  ALLOWED_STATS_TOKENS,
  ALLOWED_ADS_TOKENS,
  ALLOWED_PUBLISHERS_TOKENS
} = process.env

const braveYoutubeOwner = 'publishers#uuid:' + uuidV4().toLowerCase()
const braveYoutubePublisher = 'youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg'

const tkn = 'foobarfoobar'
const token = (tkn) => `Bearer ${tkn}`

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
const GLOBAL_TOKEN = TOKEN_LIST.split(',')[0]
const eyeshadeGlobalAgent = agent(BAT_EYESHADE_SERVER).set(AUTH_KEY, token(GLOBAL_TOKEN))
const eyeshadeReferralsAgent = agent(BAT_EYESHADE_SERVER).set(AUTH_KEY, token(ALLOWED_REFERRALS_TOKENS))
const eyeshadeStatsAgent = agent(BAT_EYESHADE_SERVER).set(AUTH_KEY, token(ALLOWED_STATS_TOKENS))
const eyeshadeAdsAgent = agent(BAT_EYESHADE_SERVER).set(AUTH_KEY, token(ALLOWED_ADS_TOKENS))
const eyeshadePublishersAgent = agent(BAT_EYESHADE_SERVER).set(AUTH_KEY, token(ALLOWED_PUBLISHERS_TOKENS))

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

const agents = {
  eyeshade: {
    global: eyeshadeGlobalAgent,
    referrals: eyeshadeReferralsAgent,
    ads: eyeshadeAdsAgent,
    publishers: eyeshadePublishersAgent,
    stats: eyeshadeStatsAgent
  }
}

module.exports = {
  transaction: {
    ensureCount: ensureTransactionCount,
    ensureArrived: ensureTransactionArrived
  },
  referral: {
    create: createReferral,
    createLegacy: createLegacyReferral
  },
  settlement: {
    create: createSettlement
  },
  token,
  signTxn,
  setupForwardingServer,
  agentAutoAuth,
  AUTH_KEY,
  readJSONFile,
  makeSettlement,
  insertReferralInfos,
  fetchReport,
  formURL,
  ok,
  debug,
  status,
  agents,
  assertWithinBounds,
  cleanEyeshadePgDb,
  cleanPgDb,
  braveYoutubeOwner,
  braveYoutubePublisher,
  setupCreatePayload,
  statsUrl
}

async function cleanEyeshadePgDb (pg) {
  const postgres = pg || new Postgres({
    postgres: {
      connectionString: process.env.BAT_POSTGRES_URL
    }
  })
  const cleaner = cleanPgDb(postgres)
  return cleaner()
}

function cleanPgDb (postgres) {
  return async () => {
    const client = await postgres.connect()
    try {
      await Promise.all([
        client.query('DELETE from payout_reports_ads'),
        client.query('DELETE from potential_payments_ads'),
        client.query('DELETE from transactions'),
        client.query('DELETE from surveyor_groups'),
        client.query('DELETE from geo_referral_countries'),
        client.query('DELETE from geo_referral_groups'),
        client.query('DELETE from votes'),
        client.query('DELETE from balance_snapshots'),
        client.query('DELETE from payout_reports')
      ])
      await insertReferralInfos(client)
    } finally {
      client.release()
    }
  }
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
    headers.signature = sign({
      headers,
      keyId: 'primary',
      secretKey: uint8tohex(keypair.secretKey)
    }, {
      algorithm: 'ed25519'
    })
    return {
      requestType: 'httpSignature',
      signedTx: {
        headers,
        octets
      },
      surveyorId,
      viewingId
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
  for (let i = 0; i < ratesPaths.length; i += 1) {
    const { path } = ratesPaths[i]
    await client.query(fs.readFileSync(path).toString())
  }

  function filePath (...paths) {
    return path.join(__dirname, '..', 'eyeshade', 'migrations', ...paths)
  }
}

function readJSONFile (...paths) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ...paths)).toString())
}

async function setupForwardingServer ({
  routes,
  config,
  initers = [],
  token = uuidV4()
}) {
  const conf = _.extend({
    sentry: {},
    server: {},
    cache: {
      redis: {
        url: process.env.BAT_REDIS_URL
      }
    },
    testingCohorts: process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : [],
    prometheus: {
      label: process.env.SERVICE + '.' + (process.env.DYNO || 1)
    },
    currency: {
      url: process.env.BAT_RATIOS_URL,
      access_token: process.env.BAT_RATIOS_TOKEN
    }
  }, config)
  const serverOpts = {
    id: uuidV4(),
    headersP: false,
    remoteP: false,
    routes: {
      routes: (debug, runtime, options) => {
        return _.toArray(routes).map((route) => route(runtime))
      }
    }
  }
  const runtime = new Runtime(conf)
  const server = await Server(serverOpts, runtime)
  await server.started
  const debug = new SDebug('init')
  for (let i = 0; i < initers.length; i += 1) {
    await initers[i](debug, runtime)
  }
  const agent = agentAutoAuth(server.listener, token)
  return {
    server,
    runtime,
    agent
  }
}

function agentAutoAuth (listener, token) {
  return agent(listener).set(AUTH_KEY, `Bearer ${token || tkn}`)
}

function signTxn (keypair, body, _octets) {
  let octets = _octets
  if (!octets) {
    octets = JSON.stringify(body)
  }
  const headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers.signature = sign({
    headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, {
    algorithm: 'ed25519'
  })
  return {
    headers,
    octets,
    body
  }
}

function createLegacyReferral (timestamp, groupId) {
  const txId = uuidV4().toLowerCase()
  return {
    txId,
    referral: {
      downloadId: uuidV4().toLowerCase(),
      channelId: braveYoutubePublisher,
      platform: 'ios',
      referralCode: uuidV4().toLowerCase(),
      finalized: timestamp || new Date(),
      groupId,
      downloadTimestamp: timestamp || new Date(),
      ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
    }
  }
}

function createReferral (options = {}) {
  const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
  return Object.assign({
    transactionId: uuidV4(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    finalizedTimestamp: (new Date()).toISOString(),
    downloadId: uuidV4(),
    downloadTimestamp: (new Date()).toISOString(),
    countryGroupId: originalRateId,
    platform: 'desktop',
    referralCode: 'ABC123'
  }, options)
}

async function ensureTransactionCount (t, expect) {
  let rows = []
  do {
    ;({ rows } = await t.context.runtime.postgres.query('select * from transactions'))
  } while (rows.length !== expect && (await timeout(1000) || true))
  return rows
}

async function ensureTransactionArrived (t, id) {
  let seen = []
  do {
    ;({ rows: seen } = await t.context.runtime.postgres.query(`
    select * from transactions where id = $1
    `, [id]))
    console.log('checking for', id)
  } while (seen.length === 0 && (await timeout(1000) || true))
  return seen
}

function createSettlement (options) {
  const amount = new BigNumber(Math.random() + '').times(10)
  const probi = amount.times(1e18)
  return Object.assign({
    settlementId: uuidV4(),
    address: uuidV4(),
    hash: uuidV4(),
    documentId: uuidV4(),
    publisher: braveYoutubePublisher,
    altcurrency: 'BAT',
    currency: 'USD',
    owner: braveYoutubeOwner,
    probi: probi.times(0.95).toFixed(0),
    amount: probi.dividedBy('1e18').toFixed(18),
    commission: '0',
    fee: '0',
    fees: probi.times(0.05).toFixed(0),
    type: 'contribution'
  }, options || {})
}
