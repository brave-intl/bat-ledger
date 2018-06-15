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
  uint8tohex
} from 'bat-utils/lib/extras-utils'

import {
  cleanDbs,
  assertWithinBounds,
  eyeshadeAgent,
  fetchReport,
  formURL,
  ledgerAgent,
  ok,
  braveYoutubeOwner,
  braveYoutubePublisher,
  createSurveyor,
  balanceAgent,
  createRedisCache
} from './utils'

import {
  accessCardId,
  configuration
} from '../balance/controllers/address'

dotenv.config()

const balanceCacheConfig = configuration.cache

let prevSurveyorId
let paymentId

const cache = createRedisCache()

const cardDeleteUrl = `/v2/card`

test.before(cleanDbs)
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
test('ledger: create promotion', async t => {
  t.plan(0)
  const url = '/v1/grants'
  // valid grant
  const valid = {
    'grants': [ 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ' ],
    'promotions': [{'active': true, 'priority': 0, 'promotionId': '902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3'}]
  }
  await ledgerAgent.post(url).send(valid).expect(ok)
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

  do { // This depends on currency conversion rates being available, retry until then are available
    response = await ledgerAgent
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('balance'))
  t.is(response.body.balance, '0.0000')

  const desired = donateAmt.toFixed(4).toString()

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

  // ensure that transactions out of the restricted user card require a signature
  // by trying to send back to the donor card
  await t.throws(uphold.createCardTransaction(userCardId,
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

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com', braveYoutubePublisher]
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

test('ledger : v2 grant contribution workflow with uphold BAT wallet', async t => {
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
    .get('/v1/grants')
    .expect(ok)

  t.true(response.body.hasOwnProperty('promotionId'))

  const promotionId = response.body.promotionId

  // request grant
  response = await ledgerAgent
      .put(`/v1/grants/${paymentId}`)
      .send({'promotionId': promotionId})
      .expect(ok)
  console.log(response.body)
  t.true(response.body.hasOwnProperty('probi'))

  const donateAmt = new BigNumber(response.body.probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()

  // try re-claiming grant, should return ok
  response = await ledgerAgent
      .put(`/v1/grants/${paymentId}`)
      .send({'promotionId': promotionId})
      .expect(ok)

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
})

test('eyeshade: create brave youtube channel and owner', async t => {
  t.plan(1)

  const { body } = await eyeshadeAgent.post('/v2/owners').send({
    'ownerId': braveYoutubeOwner,
    'contactInfo': {
      'name': 'Brave',
      'phone': '+12345678900',
      'email': 'null@brave.com'
    },
    'channels': [{
      'channelId': braveYoutubePublisher
    }]
  }).expect(ok)

  t.true(_.isObject(body))

  // set authorized / uphold parameters
  await eyeshadeAgent.put(`/v1/owners/${encodeURIComponent(braveYoutubeOwner)}/wallet`)
    .send({ 'provider': 'uphold', 'parameters': {} })
    .expect(ok)
})

test('payments are cached and can be removed', async t => {
  t.plan(8)
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

  await balanceAgent.del(walletBalanceUrl).expect(ok)
  t.is(await getCached(paymentId, balanceCacheConfig.wallet), null)
  cached = getCached(cardId, balanceCacheConfig.link)

  await balanceAgent.get(walletBalanceUrl).expect(ok)
  cached = await getCached(cardId, balanceCacheConfig.link)
  t.is(cached, paymentId)

  await balanceAgent.post(cardDeleteUrl).send({
    payload: {
      id: cardId
    }
  }).expect(ok)
  t.is(await getCached(cardId, balanceCacheConfig.link), null)
  t.is(await getCached(paymentId, balanceCacheConfig.wallet), null)
})

test('ensure contribution balances are computed correctly', async t => {
  t.plan(4)

  let { body } = await eyeshadeAgent.get(formURL('/v1/reports/publishers/contributions', { includeUnpayable: true }))
    .send().expect(ok)
  const { reportURL } = body

  ;({ body } = await fetchReport({ url: reportURL }))
  t.true(body.length > 0)

  const singleEntry = _.findWhere(body, { publisher: braveYoutubePublisher })

  const reportProbi = singleEntry.probi

  t.true(Number(reportProbi) > 0)

  ;({ body } = await eyeshadeAgent.get(`/v1/owners/${encodeURIComponent(braveYoutubeOwner)}/wallet`).send().expect(ok))
  let { contributions } = body

  t.true(Number(contributions.probi) > 0)

  // settle completely
  await eyeshadeAgent.post('/v2/publishers/settlement').send([
    {
      owner: braveYoutubeOwner,
      publisher: braveYoutubePublisher,
      address: uuid.v4(),
      altcurrency: 'BAT',
      probi: contributions.probi,
      currency: contributions.currency,
      amount: contributions.amount,
      transactionId: uuid.v4(),
      type: 'contribution',
      hash: uuid.v4()
    }
  ]).expect(ok)

  ;({ body } = await eyeshadeAgent.get(`/v1/owners/${encodeURIComponent(braveYoutubeOwner)}/wallet`).send().expect(ok))
  ;({ contributions } = body)

  t.true(Number(contributions.probi) === 0)
})

test('ensure referral balances are computed correctly', async t => {
  t.plan(5)

  await eyeshadeAgent.put('/v1/referrals/' + uuid.v4().toLowerCase()).send([
    {
      channelId: braveYoutubePublisher,
      downloadId: uuid.v4(),
      platform: 'android',
      finalized: (new Date()).toISOString()
    }
  ]).expect(ok)

  let { body } = await eyeshadeAgent.get(formURL('/v1/reports/publishers/referrals', { includeUnpayable: true }))
    .send().expect(ok)
  const { reportURL } = body

  ;({ body } = await fetchReport({ url: reportURL }))
  t.true(body.length > 0)

  const singleEntry = _.findWhere(body, { publisher: braveYoutubePublisher })

  const reportProbi = singleEntry.probi
  const fees = singleEntry.fees
  t.is(fees, '0')

  ;({ body } = await eyeshadeAgent.get(`/v1/owners/${encodeURIComponent(braveYoutubeOwner)}/wallet`).send().expect(ok))
  const { contributions } = body

  const walletProbi = new BigNumber(contributions.probi)
  const amount = Number(contributions.amount)

  t.true(walletProbi > 0)
  t.is(walletProbi.toString(), reportProbi)
  assertWithinBounds(t, amount, 5.00, 0.25, 'USD value for a referral should be approx $5')
})

async function getCached (id, group) {
  const card = await cache.get(id, group)
  const couldBeJSON = card && card[0] === '{'
  return couldBeJSON ? JSON.parse(card) : card
}
