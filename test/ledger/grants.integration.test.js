import {
  serial as test
} from 'ava'
import BigNumber from 'bignumber.js'
import crypto from 'crypto'
import anonize from 'node-anonize2-relic'
import { v4 } from 'uuid'
import { sign } from 'http-request-signature'
import tweetnacl from 'tweetnacl'
import {
  ledgerAgent,
  ok,
  cleanDbs,
  createSurveyor
} from '../utils'
import {
  timeout,
  uint8tohex
} from 'bat-utils/lib/extras-utils'

test.afterEach(cleanDbs)

test('grants: add expired grant and make sure it does not add to wallet', async t => {
  t.plan(1)
  const url = '/v1/grants'
  const promotionId = 'c96c39c8-77dd-4b2d-a8df-2ecf824bc9e9'
  // expired grant
  const expired = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1526941400000}]}
  await ledgerAgent.post(url).send(expired).expect(ok)

  const personaId = v4().toLowerCase()

  var response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  const body = {
    label: v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  var octets = JSON.stringify(body)
  var headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers.signature = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  var payload = { requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }
  response = await ledgerAgent.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  const paymentId = response.body.wallet.paymentId

  // get available grant
  await ledgerAgent
    .get('/v1/grants')
    .expect(ok)

  // request grant
  response = await ledgerAgent
      .put(`/v1/grants/${paymentId}`)
      .send({promotionId})
      .expect(ok)

  const donateAmt = new BigNumber(response.body.probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err
  t.is(response.body.balance, '0.0000')
})

test('grants ordered correctly', async t => {
  var response
  var grants
  var promotionId
  var walletInfo
  var grant1
  var grant2
  var youngerGrant
  t.plan(1)
  const viewingId = v4().toLowerCase()
  const surveyorRequest = await createSurveyor()
  const surveyorBody = surveyorRequest.body
  const surveyorId = surveyorBody.surveyorId
  const url = '/v1/grants'
  promotionId = 'd287cbfd-d501-4fb3-bd50-4d83eee031ed'
  // 5 dollars in it
  grants = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI2ZjI4MzcyOC00NWYyLTQ2ZjgtYTI1Mi1hZTNlZGYyM2EwMjMiLCJwcm9iaSI6IjUwMDAwMDAwMDAwMDAwMDAwMDAiLCJwcm9tb3Rpb25JZCI6ImQyODdjYmZkLWQ1MDEtNGZiMy1iZDUwLTRkODNlZWUwMzFlZCIsIm1hdHVyaXR5VGltZSI6MTUzMjM3Mzc5MiwiZXhwaXJ5VGltZSI6MTU0Njg5MjU5Mn0.Jnn_2j5GN4hcDa3dPWs9iUTThJZEmUo7gK69lT_0zXB6IIdTFsrmsJNRLWgmoiH3-yTHnz4J1Yju6uCiDJvtAw'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1532373792000}]}

  await ledgerAgent.post(url).send(grants).expect(ok)
  const {
    person,
    keypair
  } = await createPerson()
  const {
    paymentId
  } = person.wallet
  // get available grant
  await ledgerAgent
    .get('/v1/grants')
    .expect(ok)

  // request grant
  response = await ledgerAgent
    .put(`/v1/grants/${paymentId}`)
    .send({promotionId})
    .expect(ok)

  promotionId = '76378d97-3470-4b75-b4f0-6ded3d2c4966'
  // 6 dollars in it
  grants = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiIxYWI2M2Y3Yi04MGQ3LTRiZDEtOTliMS0xYjNmZWYwZDNiN2MiLCJwcm9iaSI6IjYwMDAwMDAwMDAwMDAwMDAwMDAiLCJwcm9tb3Rpb25JZCI6Ijc2Mzc4ZDk3LTM0NzAtNGI3NS1iNGYwLTZkZWQzZDJjNDk2NiIsIm1hdHVyaXR5VGltZSI6MTUzMjM3MzcyMCwiZXhwaXJ5VGltZSI6MTU0Njg5MjUyMH0.yagKbj0fdURWtcyJ-ukVpexQI1rDZdLTqupXs8m2HDbuSUmP_Q5M0nyvJzmnmSzgW7Wij60KXLHbthsJwg9WCQ'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1532373720000}]}

  await ledgerAgent.post(url).send(grants).expect(ok)

  // get available grant
  await ledgerAgent
    .get('/v1/grants')
    .expect(ok)

  // request grant
  response = await ledgerAgent
    .put(`/v1/grants/${paymentId}`)
    .send({promotionId})
    .expect(ok)

  walletInfo = await waitForPayment(paymentId, response.body.probi)
  ;([grant1, grant2] = walletInfo.grants)
  if (grant1.expiryTime > grant2.expiryTime) {
    youngerGrant = grant1
  } else {
    youngerGrant = grant2
  }

  await updateWallet({
    paymentId,
    payment: walletInfo,
    viewingId,
    keypair,
    surveyorId
  })
  walletInfo = await waitForPayment(paymentId, response.body.probi)
  t.deepEqual(walletInfo.grants, [youngerGrant])
})

async function updateWallet ({
  payment,
  paymentId,
  viewingId,
  keypair,
  surveyorId
}) {
  var response, octets, headers, payload
  octets = JSON.stringify(payment.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  const body = {
    label: v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  payload = {
    requestType: 'httpSignature',
    signedTx: {
      body: body,
      headers: headers,
      octets: octets
    },
    surveyorId: surveyorId,
    viewingId: viewingId
  }

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    response = await ledgerAgent
      .put('/v2/wallet/' + paymentId)
      .send(payload)
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err
  return response.body
}

async function waitForPayment (paymentId, probi) {
  var response
  const donateAmt = new BigNumber(probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()
  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err
  return response.body
}

async function createPerson () {
  const personaId = v4().toLowerCase()

  var response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  const body = {
    label: v4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  var octets = JSON.stringify(body)
  var headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers.signature = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, {
    algorithm: 'ed25519'
  })

  var payload = {
    requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }
  response = await ledgerAgent.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)
  const person = response.body
  return {
    person,
    keypair
  }
}
