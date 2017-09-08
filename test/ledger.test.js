'use strict'

import UpholdSDK from '@uphold/uphold-sdk-javascript'
import anonize from 'node-anonize2-relic'
import bg from 'bitgo'
import bitcoinjs from 'bitcoinjs-lib'
import crypto from 'crypto'
import request from 'supertest'
import test from 'ava'
import tweetnacl from 'tweetnacl'
import underscore from 'underscore'
import uuid from 'uuid'
import { sign } from '@uphold/http-signature'

import server from '../ledger/server'

const bitgo = new bg.BitGo({ env: 'prod' })

function ok (res) {
  if (res.status !== 200) {
    return new Error(JSON.stringify(res.body, null, 2).replace(/\\n/g, '\n'))
  }
}

function uint8tohex (arr) {
  var strBuilder = []
  arr.forEach(function (b) { strBuilder.push(('00' + b.toString(16)).substr(-2)) })
  return strBuilder.join('')
}

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms))

test('server api : respsonds with ack', async t => {
  const srv = await server
  const response = await request(srv.listener).get('/').expect(ok)
  t.is(response.text, 'ack.')
})

test('surveyor api : create surveyor requires auth', async t => {
  const srv = await server
  await request(srv.listener).post('/v1/surveyor/contribution').expect(401)
  t.true(true)
})

test('surveyor api : create surveyor works', async t => {
  const srv = await server
  const response = await request(srv.listener)
    .post('/v1/surveyor/contribution')
    .send({ 'adFree': {
      'fee': { 'USD': 5 },
      'satoshis': 845480,
      'votes': 5
    }})
    .set('Authorization', 'Bearer mytoken123')
    .expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
})

test('api : v1 contribution workflow', async t => {
  const srv = await server
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()

  var response = await request(srv.listener).get('/v1/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)
  const keychains = { user: bitgo.keychains().create(), passphrase: 'passphrase' }

  keychains.user.encryptedXprv = bitgo.encrypt({ password: keychains.passphrase, input: keychains.user.xprv })
  keychains.user.path = 'm'
  const payload = { keychains: { user: underscore.pick(keychains.user, [ 'xpub', 'path', 'encryptedXprv' ]) },
    proof: personaCredential.request()
  }

  response = await request(srv.listener).post('/v1/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const paymentId = response.body.wallet.paymentId

  personaCredential.finalize(response.body.verification)

  response = await request(srv.listener)
    .post('/v1/surveyor/contribution')
    .send({ 'adFree': {
      'fee': { 'USD': 5 },
      'satoshis': 845480,
      'votes': 5
    }})
    .set('Authorization', 'Bearer mytoken123')
    .expect(ok)

  response = await request(srv.listener)
    .get('/v1/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)
  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.true(response.body.payload.adFree.hasOwnProperty('satoshis'))
  t.false(response.body.payload.adFree.hasOwnProperty('altcurrency'))
  t.false(response.body.payload.adFree.hasOwnProperty('probi'))

  response = await request(srv.listener)
    .get('/v1/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    .expect(ok)
  t.true(response.body.hasOwnProperty('unsignedTx'))
  const unsignedHex = response.body.unsignedTx.transactionHex

  t.true(response.body.hasOwnProperty('satoshis'))
  t.false(response.body.hasOwnProperty('altcurrency'))
  t.false(response.body.hasOwnProperty('probi'))

  const tx = bitcoinjs.TransactionBuilder.fromTransaction(bitcoinjs.Transaction.fromHex(unsignedHex))
  const privateKeyWIF = 'L1uyy5qTuGrVXrmrsvHWHgVzW9kKdrp27wBC7Vs6nZDTF2BRUVwy'
  const keyPair = bitcoinjs.ECPair.fromWIF(privateKeyWIF)
  tx.sign(0, keyPair)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v1/wallet/' + paymentId)
      .send({
        'surveyorId': surveyorId,
        'viewingId': viewingId,
        'signedTx': tx.build().toHex()
      })
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('satoshis'))
  t.false(response.body.hasOwnProperty('altcurrency'))
  t.false(response.body.hasOwnProperty('probi'))

  response = await request(srv.listener)
    .get('/v1/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .post('/v1/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length === 5)

  viewingCredential.finalize(response.body.verification)

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com']
  for (var i = 0; i < surveyorIds.length; i++) {
    const id = surveyorIds[i]
    response = await request(srv.listener)
      .get('/v1/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok)

    const surveyor = new anonize.Surveyor(response.body)
    response = await request(srv.listener)
      .put('/v1/surveyor/voting/' + encodeURIComponent(id))
      .send({'proof': viewingCredential.submit(surveyor, { publisher: votes[i] })})
      .expect(ok)
  }
})

test('api : v2 contribution workflow with BTC', async t => {
  const srv = await server
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()

  var response = await request(srv.listener).get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)
  const keychains = { user: bitgo.keychains().create(), passphrase: 'passphrase' }

  keychains.user.encryptedXprv = bitgo.encrypt({ password: keychains.passphrase, input: keychains.user.xprv })
  keychains.user.path = 'm'
  const payload = { requestType: 'bitcoinMultisig',
    request: {
      keychains: { user: underscore.pick(keychains.user, [ 'xpub', 'path', 'encryptedXprv' ]) }
    },
    proof: personaCredential.request()
  }

  response = await request(srv.listener).post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  const paymentId = response.body.wallet.paymentId

  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.deepEqual(response.body.wallet.addresses, { 'BTC': keychains.user.xpub })

  t.true(response.body.hasOwnProperty('verification'))
  personaCredential.finalize(response.body.verification)

  response = await request(srv.listener)
    .post('/v2/surveyor/contribution')
    .send({ 'adFree': {
      'fee': { 'USD': 5 },
      'probi': '845480',
      'altcurrency': 'BTC',
      'votes': 5
    }})
    .set('Authorization', 'Bearer mytoken123')
    .expect(ok)

  response = await request(srv.listener)
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)
  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.false(response.body.payload.adFree.hasOwnProperty('satoshis'))
  t.true(response.body.payload.adFree.hasOwnProperty('altcurrency'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))

  do {
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('unsignedTx'))
  const unsignedHex = response.body.unsignedTx.transactionHex

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  const tx = bitcoinjs.TransactionBuilder.fromTransaction(bitcoinjs.Transaction.fromHex(unsignedHex))
  const privateKeyWIF = 'L1uyy5qTuGrVXrmrsvHWHgVzW9kKdrp27wBC7Vs6nZDTF2BRUVwy'
  const keyPair = bitcoinjs.ECPair.fromWIF(privateKeyWIF)
  tx.sign(0, keyPair)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v2/wallet/' + paymentId)
      .send({'requestType': 'bitcoinMultisig',
        'surveyorId': surveyorId,
        'viewingId': viewingId,
        'signedTx': tx.build().toHex()
      })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  response = await request(srv.listener)
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length === 5)

  viewingCredential.finalize(response.body.verification)

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com']
  for (var i = 0; i < surveyorIds.length; i++) {
    const id = surveyorIds[i]
    response = await request(srv.listener)
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok)

    const surveyor = new anonize.Surveyor(response.body)
    response = await request(srv.listener)
      .put('/v2/surveyor/voting/' + encodeURIComponent(id))
      .send({'proof': viewingCredential.submit(surveyor, { publisher: votes[i] })})
      .expect(ok)
  }
})

test('api : v2 contribution workflow with BAT', async t => {
  const srv = await server
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()

  var response = await request(srv.listener).get('/v2/registrar/persona').expect(ok)
  t.true(response.body.hasOwnProperty('registrarVK'))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()

  const body = {
    label: uuid.v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  var headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  var payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers
    },
    proof: personaCredential.request()
  }
  response = await request(srv.listener).post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  const paymentId = response.body.wallet.paymentId

  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.deepEqual(response.body.wallet.addresses, { 'BAT': '0x7c31560552170ce96c4a7b018e93cddc19dc61b6' })

  t.true(response.body.hasOwnProperty('verification'))
  personaCredential.finalize(response.body.verification)

  response = await request(srv.listener)
    .post('/v2/surveyor/contribution')
    .send({ 'adFree': {
      'fee': { 'USD': 5 },
      'probi': '24123500000000000000',
      'altcurrency': 'BAT',
      'votes': 5
    }})
    .set('Authorization', 'Bearer mytoken123')
    .expect(ok)

  response = await request(srv.listener)
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)
  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  t.true(response.body.hasOwnProperty('payload'))
  t.true(response.body.payload.hasOwnProperty('adFree'))
  t.false(response.body.payload.adFree.hasOwnProperty('satoshis'))
  t.true(response.body.payload.adFree.hasOwnProperty('altcurrency'))
  t.true(response.body.payload.adFree.hasOwnProperty('probi'))

  do {
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('balance'))
  // FIXME
  t.is(response.body.balance, '32.0618')

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  t.true(response.body.hasOwnProperty('unsignedTx'))

  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(response.body.unsignedTx)).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.false(response.body.hasOwnProperty('satoshis'))
  t.true(response.body.hasOwnProperty('altcurrency'))
  t.true(response.body.hasOwnProperty('probi'))

  response = await request(srv.listener)
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(response.body.hasOwnProperty('registrarVK'))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('surveyorIds'))
  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length === 5)

  viewingCredential.finalize(response.body.verification)

  const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com']
  for (var i = 0; i < surveyorIds.length; i++) {
    const id = surveyorIds[i]
    response = await request(srv.listener)
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok)

    const surveyor = new anonize.Surveyor(response.body)
    response = await request(srv.listener)
      .put('/v2/surveyor/voting/' + encodeURIComponent(id))
      .send({'proof': viewingCredential.submit(surveyor, { publisher: votes[i] })})
      .expect(ok)
  }
})

// FIXME assert has env vars set and is using uphold
test('api : v2 uphold BAT wallet', async t => {
  const srv = await server
  const personaId = uuid.v4().toLowerCase()
  const viewingId = uuid.v4().toLowerCase()
  const donateAmt = 0.01

  var response = await request(srv.listener).get('/v2/registrar/persona').expect(ok)
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
  var headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  var payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers
    },
    proof: personaCredential.request()
  }
  response = await request(srv.listener).post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  t.true(response.body.hasOwnProperty('wallet'))
  const paymentId = response.body.wallet.paymentId
  t.true(response.body.wallet.hasOwnProperty('paymentId'))
  t.true(response.body.wallet.hasOwnProperty('addresses'))
  t.true(response.body.wallet.addresses.hasOwnProperty('BAT'))
  t.true(response.body.hasOwnProperty('verification'))

  t.true(response.body.wallet.addresses.hasOwnProperty('CARD_ID'))
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)

  response = await request(srv.listener)
    .post('/v2/surveyor/contribution')
    .send({ 'adFree': {
      'fee': { 'USD': 5 },
      'probi': '24123500000000000000',
      'altcurrency': 'BAT',
      'votes': 5
    }})
    .set('Authorization', 'Bearer mytoken123')
    .expect(ok)

  response = await request(srv.listener)
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)
  t.true(response.body.hasOwnProperty('surveyorId'))
  const surveyorId = response.body.surveyorId

  do { // This depends on currency conversion rates being available, retry until then are available
    response = await request(srv.listener)
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503) await snooze(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err

  t.true(response.body.hasOwnProperty('balance'))
  t.is(response.body.balance, '0.0000')

  const rate = response.body.rates.USD
  const desired = (donateAmt * rate).toFixed(4)

  const uphold = new UpholdSDK({ // eslint-disable-line new-cap
    baseUrl: 'https://api-sandbox.uphold.com',
    clientId: 'none',
    clientSecret: 'none'
  })
  // have to do some hacky shit to use a personal access token
  uphold.storage.setItem('uphold.access_token', process.env.UPHOLD_ACCESS_TOKEN)
  const donorCardId = process.env.UPHOLD_DONOR_CARD_ID

  await uphold.createCardTransaction(donorCardId,
    {'amount': donateAmt.toString(), 'currency': 'BAT', 'destination': userCardId},
    true // commit tx in one swoop
  )

  do {
    response = await request(srv.listener)
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&currency=USD`)
    if (response.status === 503) await snooze(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await snooze(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  // ensure that transactions out of the restricted user card require a signature
  // by trying to send back to the donor card
  await t.throws(uphold.createCardTransaction(userCardId,
    {'amount': donateAmt.toString(), 'currency': 'BAT', 'destination': donorCardId},
    true // commit tx in one swoop
  ))

  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(response.body.unsignedTx)).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  payload = { requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await snooze(response.headers['retry-after'] * 1000)
    }
    response = await request(srv.listener)
      .put('/v2/wallet/' + paymentId)
      .send(payload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err
})

// FIXME add a test to cover the user pledging to donate an amount ~= 0

// FIXME add a test to cover the case where the requested amount is less than the unsignedTx minimum
