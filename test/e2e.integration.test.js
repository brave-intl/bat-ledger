'use strict'
import BigNumber from 'bignumber.js'
import UpholdSDK from '@uphold/uphold-sdk-javascript'
import anonize from 'node-anonize2-relic'
import crypto from 'crypto'
import { serial as test } from 'ava'
import tweetnacl from 'tweetnacl'
import uuid from 'uuid'
import { sign } from 'http-request-signature'
import _ from 'underscore'
import dotenv from 'dotenv'

import {
  timeout,
  uint8tohex,
  justDate
} from 'bat-utils/lib/extras-utils'
import Cache from 'bat-utils/lib/runtime-cache'
import Postgres from 'bat-utils/lib/runtime-postgres'
import Queue from 'bat-utils/lib/runtime-queue'

import {
  cleanDbs,
  eyeshadeAgent,
  ledgerAgent,
  ok,
  braveYoutubeOwner,
  braveYoutubePublisher,
  createSurveyor,
  balanceAgent,
  debug,
  connectToDb
} from './utils'

import {
  accessCardId,
  configuration
} from '../balance/controllers/address'
import {
  freezeOldSurveyors
} from '../eyeshade/workers/reports'

dotenv.config()

const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})

const balanceCacheConfig = configuration.cache

let prevSurveyorId
let paymentId

const cache = new Cache({
  cache: {
    redis: {
      url: process.env.BAT_REDIS_URL
    }
  }
})

const queue = new Queue({
  queue: {
    rsmq: process.env.BAT_REDIS_URL
  }
})

const runtime = {
  postgres,
  queue
}

const cardDeleteUrl = `/v2/card`
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
const statsURL = `/v2/wallet/stats/${date}/${future}`
const probi12 = (new BigNumber(12)).times(1e18).toString()

test.after(cleanDbs)

test('ledger: create a surveyor', async t => {
  // need access to eyeshade db
  t.plan(5)
  let response
  const options = {
    rate: 1,
    votes: 12
  }

  response = await createSurveyor(options)

  prevSurveyorId = response.body.surveyorId
  t.true(_.isString(prevSurveyorId))
  t.true(!!prevSurveyorId)

  // create new surveyor and verify the id changed
  response = await createSurveyor(options)
  const { surveyorId } = response.body
  t.true(_.isString(surveyorId))
  t.true(!!surveyorId)
  t.not(prevSurveyorId, surveyorId)
})

const promotionId = '902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3'
const grants = {
  'grants': [ 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ' ],
  'promotions': [{'active': true, 'priority': 0, 'promotionId': promotionId}]
}
test('ledger: create promotion', async t => {
  t.plan(0)
  const url = '/v2/grants'
  // valid grant
  await ledgerAgent.post(url).send(grants).expect(ok)
})

test('check stats endpoint before wallets add', async t => {
  t.plan(1)
  let body
  ;({ body } = await ledgerAgent.get(statsURL).expect(ok))
  t.deepEqual(body, [])
})

test('ledger : v2 contribution workflow with uphold BAT wallet', async t => {
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()
  let response, octets, headers, payload, err

  response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  console.log('created new ed25519 keypair')
  console.log(JSON.stringify({
    'publicKey': uint8tohex(keypair.publicKey),
    'secretKey': uint8tohex(keypair.secretKey)
  }))

  const body = {
    label: uuid.v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  octets = JSON.stringify(body)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }
  response = await ledgerAgent.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  paymentId = response.body.wallet.paymentId
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.hasOwnProperty('verification'))

  t.true(response.body.wallet.addresses.hasOwnProperty('BAT'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BTC'))
  t.true(response.body.wallet.addresses.hasOwnProperty('CARD_ID'))
  t.true(response.body.wallet.addresses.hasOwnProperty('ETH'))
  t.true(response.body.wallet.addresses.hasOwnProperty('LTC'))
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)

  response = await ledgerAgent.get('/v2/wallet?publicKey=' + uint8tohex(keypair.publicKey))
    .expect(ok)
  t.true(response.body.paymentId === paymentId)

  response = await ledgerAgent
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)

  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))
  const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()

  response = await ledgerAgent.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 0,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 1,
    contributed: 0,
    wallets: 1
  }])

  do { // This depends on currency conversion rates being available, retry until then are available
    response = await ledgerAgent
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('balance'))
  t.true(_.isString(response.body.httpSigningPubKey))
  t.is(response.body.balance, '0.0000')

  const desired = donateAmt.toFixed(4).toString()

  response = await ledgerAgent.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 1,
    contributed: 0,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets: 1
  }])

  const upholdBaseUrls = {
    'prod': 'https://api.uphold.com',
    'sandbox': 'https://api-sandbox.uphold.com'
  }
  const environment = process.env.UPHOLD_ENVIRONMENT || 'sandbox'

  const uphold = new UpholdSDK({ // eslint-disable-line new-cap
    baseUrl: upholdBaseUrls[environment],
    clientId: 'none',
    clientSecret: 'none'
  })
  // have to do some hacky shit to use a personal access token
  uphold.storage.setItem('uphold.access_token', process.env.UPHOLD_ACCESS_TOKEN)
  const donorCardId = process.env.UPHOLD_DONOR_CARD_ID

  await uphold.createCardTransaction(donorCardId,
    {'amount': desired, 'currency': 'BAT', 'destination': userCardId},
    true // commit tx in one swoop
  )

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  t.is(Number(response.body.unsignedTx.denomination.amount), Number(desired))
  const { rates } = response.body
  console.log(rates)
  t.true(_.isObject(rates))
  t.true(_.isNumber(rates.BTC))
  t.true(_.isNumber(rates.ETH))
  t.true(_.isNumber(rates.LTC))
  t.true(_.isNumber(rates.USD))
  t.true(_.isNumber(rates.EUR))

  // ensure that transactions out of the restricted user card require a signature
  // by trying to send back to the donor card
  await t.throwsAsync(uphold.createCardTransaction(userCardId,
    {'amount': desired, 'currency': 'BAT', 'destination': donorCardId},
    true // commit tx in one swoop
  ))

  octets = JSON.stringify(response.body.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers,
      octets: octets
    },
    surveyorId: prevSurveyorId,
    viewingId: viewingId
  }

  // first post to an old contribution surveyor, this should fail
  response = await ledgerAgent.put('/v2/wallet/' + paymentId).send(payload)
  t.true(response.status === 410)

  payload.surveyorId = surveyorId

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await ledgerAgent
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  response = await ledgerAgent.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 1,
    contributed: 1,
    created: justDate(new Date()),
    walletProviderBalance: probi12,
    walletProviderFunded: 1,
    wallets: 1
  }])

  response = await ledgerAgent
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await ledgerAgent
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length >= 5)

  viewingCredential.finalize(response.body.verification)

  const votes = [
    'wikipedia.org',
    'reddit.com',
    'youtube.com',
    'ycombinator.com',
    'google.com',
    'facebook.com',
    'gab.ai',
    'bit.tube',
    'duckduckgo.com',
    'everipedia.org',
    braveYoutubePublisher
  ]
  for (let i = 0; i < surveyorIds.length; i++) {
    const id = surveyorIds[i]
    response = await ledgerAgent
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok)

    const surveyor = new anonize.Surveyor(response.body)
    response = await ledgerAgent
      .put('/v2/surveyor/voting/' + encodeURIComponent(id))
      .send({'proof': viewingCredential.submit(surveyor, { publisher: votes[i % votes.length] })})
      .expect(ok)
  }
})

test('ledger: v2 grant contribution workflow with uphold BAT wallet', async t => {
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()
  let response, octets, headers, payload, err

  response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  console.log('created new ed25519 keypair')
  console.log(JSON.stringify({
    'publicKey': uint8tohex(keypair.publicKey),
    'secretKey': uint8tohex(keypair.secretKey)
  }))

  const body = {
    label: uuid.v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  octets = JSON.stringify(body)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }
  response = await ledgerAgent.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const paymentId = response.body.wallet.paymentId
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.hasOwnProperty('verification'))

  t.true(response.body.wallet.addresses.hasOwnProperty('BAT'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BTC'))
  t.true(response.body.wallet.addresses.hasOwnProperty('CARD_ID'))
  t.true(response.body.wallet.addresses.hasOwnProperty('ETH'))
  t.true(response.body.wallet.addresses.hasOwnProperty('LTC'))

  personaCredential.finalize(response.body.verification)

  response = await ledgerAgent
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)
  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))
  // const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()

  // get available grant
  response = await ledgerAgent
    .get('/v2/grants')
    .expect(ok)

  t.true(response.body.hasOwnProperty('promotionId'))

  t.is(response.body.promotionId, promotionId)

  await ledgerAgent
    .get(`/v2/captchas/${paymentId}`)
    .set('brave-product', 'brave-core')
    .expect(ok)

  const ledgerDB = await connectToDb('ledger')
  const wallets = ledgerDB.collection('wallets')
  const {
    captcha
  } = await wallets.findOne({ paymentId })

  // request grant
  response = await ledgerAgent
      .put(`/v2/grants/${paymentId}`)
      .send({
        promotionId,
        captchaResponse: {
          x: captcha.x,
          y: captcha.y
        }
      })
      .expect(ok)
  console.log(response.body)
  t.true(response.body.hasOwnProperty('probi'))

  const donateAmt = new BigNumber(response.body.probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()

  response = await ledgerAgent.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 1,
    anyFunds: 2,
    contributed: 1,
    created: justDate(new Date()),
    walletProviderBalance: probi12,
    walletProviderFunded: 2,
    wallets: 2
  }])

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  t.is(Number(response.body.unsignedTx.denomination.amount), Number(desired))

  octets = JSON.stringify(response.body.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers,
      octets: octets
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await ledgerAgent
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  response = await ledgerAgent
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await ledgerAgent
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length >= 5)

  viewingCredential.finalize(response.body.verification)

  response = await ledgerAgent
    .get(`/v2/batch/surveyor/voting/${viewingCredential.parameters.userId}`)
    .expect(ok)

  const bulkVotePayload = response.body.map(item => {
    const surveyor = new anonize.Surveyor(item)
    return {
      surveyorId: item.surveyorId,
      proof: viewingCredential.submit(surveyor, { publisher: 'basicattentiontoken.org' })
    }
  })

  await ledgerAgent
    .post('/v2/batch/surveyor/voting')
    .send(bulkVotePayload)
    .expect(ok)

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.grants.length === 0)

  // unsync grant state between ledger and the grant server
  const data = {
    $set: { 'grants.$.status': 'active' }
  }
  const query = {
    'grants.promotionId': promotionId
  }
  await wallets.findOneAndUpdate(query, data)

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  t.true(response.body.grants.length > 0)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await ledgerAgent
       .put('/v2/wallet/' + paymentId)
       .send(payload)
  } while (response.status === 503)

  t.is(response.status, 410)

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.grants.length === 0)
})

test('eyeshade: create brave youtube channel and owner', async t => {
  t.plan(1)
  // set authorized / uphold parameters
  await eyeshadeAgent.put(`/v1/owners/${encodeURIComponent(braveYoutubeOwner)}/wallet`)
    .send({ 'provider': 'uphold', 'parameters': {} })
    .expect(ok)
  t.true(true)
})

test('check stats endpoint', async t => {
  t.plan(1)
  let body
  ;({ body } = await ledgerAgent.get(statsURL).expect(ok))
  const created = justDate(new Date())
  t.deepEqual(body, [{
    activeGrant: 0,
    anyFunds: 2,
    contributed: 2,
    created,
    walletProviderBalance: probi12,
    walletProviderFunded: 1,
    wallets: 2
  }])
})

test('payments are cached and can be removed', async t => {
  t.plan(6)
  let cached
  const walletBalanceUrl = `/v2/wallet/${paymentId}/balance`

  t.is(await getCached(paymentId, balanceCacheConfig.wallet), null)

  await balanceAgent.get(walletBalanceUrl).expect(ok)
  cached = await getCached(paymentId, balanceCacheConfig.wallet)
  t.true(_.isObject(cached))

  const cardId = accessCardId(cached)
  cached = await getCached(cardId, balanceCacheConfig.link)
  t.is(cached, paymentId)

  await balanceAgent.get(walletBalanceUrl).expect(ok)
  cached = await getCached(cardId, balanceCacheConfig.link)
  t.is(cached, paymentId)

  await balanceAgent.post(cardDeleteUrl).send({
    payload: {
      id: cardId,
      context: {
        transaction: {
          id: 'id-goes-here'
        }
      }
    }
  }).expect(ok)
  t.is(await getCached(cardId, balanceCacheConfig.link), paymentId)
  t.is(await getCached(paymentId, balanceCacheConfig.wallet), null)
})

test('check pending tx endpoint', async (t) => {
  t.plan(3)
  const url = '/v1/accounts/balances'
  let body = []
  while (!body.length) {
    await timeout(2000)
    ;({
      body
    } = await eyeshadeAgent.get(url)
      .query({
        pending: true,
        account: braveYoutubePublisher
      })
      .expect(ok))
  }
  t.deepEqual(body, [{
    account_id: braveYoutubePublisher,
    account_type: 'channel',
    balance: '1.000000000000000000'
  }], 'pending votes show up after small delay')
  ;({
    body
  } = await eyeshadeAgent.get(url)
    .query({
      pending: false,
      account: braveYoutubePublisher
    }))
  t.deepEqual(body, [], 'pending votes are not counted if pending is not true')
  ;({
    body
  } = await eyeshadeAgent.get(url)
    .query({
      account: braveYoutubePublisher
    }))
  t.deepEqual(body, [], 'endpoint defaults pending to false')
})

test('ensure contribution balances are computed correctly', async t => {
  t.plan(3)

  let amount
  let probi
  let fees
  let body
  let entry
  const account = [braveYoutubePublisher]
  const query = { account }
  const balanceURL = '/v1/accounts/balances'

  await freezeOldSurveyors(debug, runtime, -1)

  body = []
  do {
    await timeout(5000)
    ;({ body } = await eyeshadeAgent
      .get(balanceURL)
      .query(query)
      .expect(ok))
    entry = body[0]
  } while (!entry)

  t.true(entry.balance > 0)

  amount = new BigNumber(entry.balance).times(1e18)
  fees = amount.times(0.05)
  probi = amount.times(0.95)
  // settle completely
  const settlement = {
    fees: fees.toString(),
    probi: probi.toString(),
    amount: amount.dividedBy(1e18).toString(),
    currency: 'USD',
    owner: braveYoutubeOwner,
    publisher: braveYoutubePublisher,
    address: uuid.v4(),
    altcurrency: 'BAT',
    transactionId: uuid.v4(),
    type: 'contribution',
    hash: uuid.v4()
  }

  await eyeshadeAgent.post('/v2/publishers/settlement').send([settlement]).expect(ok)

  do {
    await timeout(5000)
    ;({ body } = await eyeshadeAgent
      .get(balanceURL)
      .query(query)
      .expect(ok))
    entry = body[0]
  } while (+entry.balance)

  const { balance } = entry
  t.true(balance.length > 1)
  t.is(+balance, 0)
})

test('ensure referral balances are computed correctly', async t => {
  let transactions
  const encoded = encodeURIComponent(braveYoutubeOwner)
  const transactionsURL = `/v1/accounts/${encoded}/transactions`
  const referralKey = uuid.v4().toLowerCase()
  const referralURL = '/v1/referrals/' + referralKey
  const referral = {
    ownerId: braveYoutubeOwner,
    channelId: braveYoutubePublisher,
    downloadId: uuid.v4(),
    platform: 'android',
    finalized: (new Date()).toISOString()
  }
  const referrals = [referral]

  transactions = await getReferrals()
  t.deepEqual(transactions, [])

  await eyeshadeAgent
    .put(referralURL)
    .send(referrals)
    .expect(ok)

  transactions = []
  do {
    await timeout(5000)
    transactions = await getReferrals()
  } while (!transactions.length)

  const [tx] = transactions
  const { amount } = tx
  t.true(amount.length > 1)
  t.true(amount > 0)

  async function getReferrals () {
    const {
      body: transactions
    } = await eyeshadeAgent
      .get(transactionsURL)
      .expect(ok)
    return transactions.filter(({ transaction_type: type }) => type === 'referral')
  }
})

test('check stats endpoint after funds move', async t => {
  t.plan(1)
  const created = justDate(new Date())
  let body
  ;({ body } = await ledgerAgent.get(statsURL).expect(ok))
  t.deepEqual(body, [{
    activeGrant: 0,
    anyFunds: 2,
    contributed: 2,
    created,
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets: 2
  }])
})

test('ensure top balances are available', async t => {
  t.plan(2)
  const limit = 2
  const query = {
    limit
  }
  const originalType = 'channel'
  const balanceLimitURL = `/v1/accounts/balances/${originalType}/top`
  const {
    body: limited
  } = await eyeshadeAgent
    .get(balanceLimitURL)
    .query(query)
    .expect(ok)

  t.is(limited.length, 2)

  const {
    body: unlimited
  } = await eyeshadeAgent
    .get(balanceLimitURL)
    .expect(ok)

  t.is(unlimited.length, 10)

  unlimited.forEach(({
    account_type: type
  }) => {
    if (type !== originalType) {
      throw new Error(`type returned does not match`)
    }
  })
})

async function getCached (id, group) {
  const card = await cache.get(id, group)
  const couldBeJSON = card && card[0] === '{'
  return couldBeJSON ? JSON.parse(card) : card
}
