import {
  serial as test
} from 'ava'
import BigNumber from 'bignumber.js'
import crypto from 'crypto'
import anonize from 'node-anonize2-relic'
import { v4 } from 'uuid'
import { sign } from 'http-request-signature'
import tweetnacl from 'tweetnacl'
import _ from 'underscore'
import {
  ledgerAgent,
  ok,
  cleanDbs,
  connectToDb
} from '../utils'
import {
  timeout,
  uint8tohex
} from 'bat-utils/lib/extras-utils'

test.before(cleanDbs)
test.after(cleanDbs)

const promotionId = 'c96c39c8-77dd-4b2d-a8df-2ecf824bc9e9'
// expired grant
const expired = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1526941400000}]}
test('grants: add expired grant and make sure it does not add to wallet', async t => {
  t.plan(10)
  let body, item
  const url = '/v1/grants'
  await ledgerAgent.post(url).send(expired).expect(ok)

  const personaId = v4().toLowerCase()

  var response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()
  body = {
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

  ;({ body } = await ledgerAgent.get('/v1/promotions').expect(ok))
  t.true(_.isArray(body))
  ;([ item ] = body)
  t.true(_.isObject(item))
  t.is(_.keys(item).length, 6)
  t.is(item.promotionId, promotionId)
  t.is(item.active, true)
  t.is(item.count, 0)
  // different for each one
  t.true(_.isNumber(item.minimumReconcileTimestamp))
  t.is(item.priority, 0)
  t.is(item.protocolVersion, 1)

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

test('getting grant from v2', async t => {
  let item, body
  const url = '/v2/promotions'
  const protocolVersion = 2
  const db = await connectToDb('ledger')
  const newPromotionId = promotionId + 'nu'
  const where = {
    promotionId: newPromotionId,
    protocolVersion
  }
  const $set = Object.assign({
    count: 0
  }, expired.promotions[0], where)
  const state = {
    $set
  }
  const options = { upsert: true }
  await db.collection('promotions').update(where, state, options)
  ;({ body } = await ledgerAgent.get(url).expect(ok))
  t.true(_.isArray(body))
  ;([ item ] = body)
  t.true(_.isObject(item))
  t.is(_.keys(item).length, 6)
  t.is(item.promotionId, newPromotionId)
  t.is(item.active, true)
  t.is(item.count, 0)
  // different for each one
  t.true(_.isNumber(item.minimumReconcileTimestamp))
  t.is(item.priority, 0)
  t.is(item.protocolVersion, 2)
})
