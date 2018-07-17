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
  createSurveyor
} from '../utils'
import {
  timeout,
  uint8tohex
} from 'bat-utils/lib/extras-utils'

test('grants: add expired grant and make sure it does not add to wallet', async t => {
  t.plan(1)
  const url = '/v1/grants'
  const promotionId = 'c96c39c8-77dd-4b2d-a8df-2ecf824bc9e9'
  // expired grant
  const expired = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1526941400000}]}
  await ledgerAgent.post(url).send(expired).expect(ok)
  const person = await createPerson()
  const paymentId = person.wallet.paymentId

  // get available grant
  await ledgerAgent
    .get('/v1/grants')
    .expect(ok)

  // request grant
  let response = await ledgerAgent
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


test('make sure minimumReconcileTimestamp is respected', async (t) => {
  // t.plan(0)
  var response
  const url = '/v1/grants'
  // valid grant
  const valid1PromotionID = "88abdce4-13f8-4c48-a8e4-52676996f7a6"
  const valid2PromotionID = "4ff8bc2d-c133-4fa5-b183-de5b302b82bd"
  response = await createSurveyor({
    rate: 1,
    votes: 12
  })
  const valid1 = {"grants":["eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI1MWI3YWI1My0xMDdhLTQ5MWUtODEwMy01NWEzOTBiZWQzZmYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI4OGFiZGNlNC0xM2Y4LTRjNDgtYThlNC01MjY3Njk5NmY3YTYiLCJtYXR1cml0eVRpbWUiOjE1MzE4NTk0MjUsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.FFAen3zD6aBBQb_hMU08nI85cPKuqwTaVj4vbHWk-9L1OdPOnpTJ8EHT2mWGoeZmdichycW0xYRxt293OG7qDg" ],"promotions":[{"promotionId":valid1PromotionID,"priority":0,"active":true,"minimumReconcileTimestamp":1531859425000}]}
  const valid2 = {"grants":["eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiIwMWJjNjk2My05MGNhLTQ5YjktODQ5YS0zNmM0YjI1ZGY2OTEiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI0ZmY4YmMyZC1jMTMzLTRmYTUtYjE4My1kZTViMzAyYjgyYmQiLCJtYXR1cml0eVRpbWUiOjE1MzE4NTk1MDMsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.uIAZPpJjDWlHUM0k0xx1kD48VLuGhmm_-09NYVYh_A97ZvSKa1XFLnFWvLOmSwO-q-nivnFLGKH4ZkD9m9zqAw"],"promotions":[{"promotionId":valid2PromotionID,"priority":0,"active":true,"minimumReconcileTimestamp":1531859503000}]}
  await ledgerAgent.post(url).send(valid1).expect(ok)
  await ledgerAgent.post(url).send(valid2).expect(ok)
  const person = await createPerson()
  const paymentId = person.wallet.paymentId
  // get available grant
  await ledgerAgent
    .get('/v1/grants')
    .expect(ok)
  // request grant
  response = await ledgerAgent
      .put(`/v1/grants/${paymentId}`)
      .send({promotionId: valid1PromotionID})
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

async function createPerson() {
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

  return response.body
}
