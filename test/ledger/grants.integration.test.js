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
} from 'bat-utils/test'
import {
  timeout,
  uint8tohex
} from 'bat-utils/lib/extras-utils'

test.before(cleanDbs)
test.after(cleanDbs)

const promotionId = 'c96c39c8-77dd-4b2d-a8df-2ecf824bc9e9'
// expired grant
const expired = {'grants': ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'], 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1526941400000}]}

const BAT_CAPTCHA_BRAVE_TOKEN = 'eyJhbGciOiJSUzI1NiIsIng1YyI6WyJNSUlGa2pDQ0JIcWdBd0lCQWdJUVJYcm9OMFpPZFJrQkFBQUFBQVB1bnpBTkJna3Foa2lHOXcwQkFRc0ZBREJDTVFzd0NRWURWUVFHRXdKVlV6RWVNQndHQTFVRUNoTVZSMjl2WjJ4bElGUnlkWE4wSUZObGNuWnBZMlZ6TVJNd0VRWURWUVFERXdwSFZGTWdRMEVnTVU4eE1CNFhEVEU0TVRBeE1EQTNNVGswTlZvWERURTVNVEF3T1RBM01UazBOVm93YkRFTE1Ba0dBMVVFQmhNQ1ZWTXhFekFSQmdOVkJBZ1RDa05oYkdsbWIzSnVhV0V4RmpBVUJnTlZCQWNURFUxdmRXNTBZV2x1SUZacFpYY3hFekFSQmdOVkJBb1RDa2R2YjJkc1pTQk1URU14R3pBWkJnTlZCQU1URW1GMGRHVnpkQzVoYm1SeWIybGtMbU52YlRDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTmpYa3owZUsxU0U0bSsvRzV3T28rWEdTRUNycWRuODhzQ3BSN2ZzMTRmSzBSaDNaQ1laTEZIcUJrNkFtWlZ3Mks5RkcwTzlyUlBlUURJVlJ5RTMwUXVuUzl1Z0hDNGVnOW92dk9tK1FkWjJwOTNYaHp1blFFaFVXWEN4QURJRUdKSzNTMmFBZnplOTlQTFMyOWhMY1F1WVhIRGFDN09acU5ub3NpT0dpZnM4djFqaTZIL3hobHRDWmUybEorN0d1dHpleEtweHZwRS90WlNmYlk5MDVxU2xCaDlmcGowMTVjam5RRmtVc0FVd21LVkFVdWVVejR0S2NGSzRwZXZOTGF4RUFsK09raWxNdElZRGFjRDVuZWw0eEppeXM0MTNoYWdxVzBXaGg1RlAzOWhHazlFL0J3UVRqYXpTeEdkdlgwbTZ4RlloaC8yVk15WmpUNEt6UEpFQ0F3RUFBYU9DQWxnd2dnSlVNQTRHQTFVZER3RUIvd1FFQXdJRm9EQVRCZ05WSFNVRUREQUtCZ2dyQmdFRkJRY0RBVEFNQmdOVkhSTUJBZjhFQWpBQU1CMEdBMVVkRGdRV0JCUXFCUXdHV29KQmExb1RLcXVwbzRXNnhUNmoyREFmQmdOVkhTTUVHREFXZ0JTWTBmaHVFT3ZQbSt4Z254aVFHNkRyZlFuOUt6QmtCZ2dyQmdFRkJRY0JBUVJZTUZZd0p3WUlLd1lCQlFVSE1BR0dHMmgwZEhBNkx5OXZZM053TG5CcmFTNW5iMjluTDJkMGN6RnZNVEFyQmdnckJnRUZCUWN3QW9ZZmFIUjBjRG92TDNCcmFTNW5iMjluTDJkemNqSXZSMVJUTVU4eExtTnlkREFkQmdOVkhSRUVGakFVZ2hKaGRIUmxjM1F1WVc1a2NtOXBaQzVqYjIwd0lRWURWUjBnQkJvd0dEQUlCZ1puZ1F3QkFnSXdEQVlLS3dZQkJBSFdlUUlGQXpBdkJnTlZIUjhFS0RBbU1DU2dJcUFnaGg1b2RIUndPaTh2WTNKc0xuQnJhUzVuYjI5bkwwZFVVekZQTVM1amNtd3dnZ0VFQmdvckJnRUVBZFo1QWdRQ0JJSDFCSUh5QVBBQWR3Q2t1UW1RdEJoWUZJZTdFNkxNWjNBS1BEV1lCUGtiMzdqamQ4ME95QTNjRUFBQUFXWmREM1BMQUFBRUF3QklNRVlDSVFDU1pDV2VMSnZzaVZXNkNnK2dqLzl3WVRKUnp1NEhpcWU0ZVk0Yy9teXpqZ0loQUxTYmkvVGh6Y3pxdGlqM2RrM3ZiTGNJVzNMbDJCMG83NUdRZGhNaWdiQmdBSFVBVmhRR21pL1h3dXpUOWVHOVJMSSt4MFoydWJ5WkVWekE3NVNZVmRhSjBOMEFBQUZtWFE5ejVBQUFCQU1BUmpCRUFpQmNDd0E5ajdOVEdYUDI3OHo0aHIvdUNIaUFGTHlvQ3EySzAreUxSd0pVYmdJZ2Y4Z0hqdnB3Mm1CMUVTanEyT2YzQTBBRUF3Q2tuQ2FFS0ZVeVo3Zi9RdEl3RFFZSktvWklodmNOQVFFTEJRQURnZ0VCQUk5blRmUktJV2d0bFdsM3dCTDU1RVRWNmthenNwaFcxeUFjNUR1bTZYTzQxa1p6d0o2MXdKbWRSUlQvVXNDSXkxS0V0MmMwRWpnbG5KQ0YyZWF3Y0VXbExRWTJYUEx5RmprV1FOYlNoQjFpNFcyTlJHelBodDNtMWI0OWhic3R1WE02dFg1Q3lFSG5UaDhCb200L1dsRmloemhnbjgxRGxkb2d6L0syVXdNNlM2Q0IvU0V4a2lWZnYremJKMHJqdmc5NEFsZGpVZlV3a0k5Vk5NakVQNWU4eWRCM29MbDZnbHBDZUY1ZGdmU1g0VTl4MzVvai9JSWQzVUUvZFBwYi9xZ0d2c2tmZGV6dG1VdGUvS1Ntcml3Y2dVV1dlWGZUYkkzenNpa3daYmtwbVJZS21qUG1odjRybGl6R0NHdDhQbjhwcThNMktEZi9QM2tWb3QzZTE4UT0iLCJNSUlFU2pDQ0F6S2dBd0lCQWdJTkFlTzBtcUdOaXFtQkpXbFF1REFOQmdrcWhraUc5dzBCQVFzRkFEQk1NU0F3SGdZRFZRUUxFeGRIYkc5aVlXeFRhV2R1SUZKdmIzUWdRMEVnTFNCU01qRVRNQkVHQTFVRUNoTUtSMnh2WW1Gc1UybG5iakVUTUJFR0ExVUVBeE1LUjJ4dlltRnNVMmxuYmpBZUZ3MHhOekEyTVRVd01EQXdOREphRncweU1URXlNVFV3TURBd05ESmFNRUl4Q3pBSkJnTlZCQVlUQWxWVE1SNHdIQVlEVlFRS0V4VkhiMjluYkdVZ1ZISjFjM1FnVTJWeWRtbGpaWE14RXpBUkJnTlZCQU1UQ2tkVVV5QkRRU0F4VHpFd2dnRWlNQTBHQ1NxR1NJYjNEUUVCQVFVQUE0SUJEd0F3Z2dFS0FvSUJBUURRR005RjFJdk4wNXprUU85K3ROMXBJUnZKenp5T1RIVzVEekVaaEQyZVBDbnZVQTBRazI4RmdJQ2ZLcUM5RWtzQzRUMmZXQllrL2pDZkMzUjNWWk1kUy9kTjRaS0NFUFpSckF6RHNpS1VEelJybUJCSjV3dWRnem5kSU1ZY0xlL1JHR0ZsNXlPRElLZ2pFdi9TSkgvVUwrZEVhbHROMTFCbXNLK2VRbU1GKytBY3hHTmhyNTlxTS85aWw3MUkyZE44RkdmY2Rkd3VhZWo0YlhocDBMY1FCYmp4TWNJN0pQMGFNM1Q0SStEc2F4bUtGc2JqemFUTkM5dXpwRmxnT0lnN3JSMjV4b3luVXh2OHZObWtxN3pkUEdIWGt4V1k3b0c5aitKa1J5QkFCazdYckpmb3VjQlpFcUZKSlNQazdYQTBMS1cwWTN6NW96MkQwYzF0Skt3SEFnTUJBQUdqZ2dFek1JSUJMekFPQmdOVkhROEJBZjhFQkFNQ0FZWXdIUVlEVlIwbEJCWXdGQVlJS3dZQkJRVUhBd0VHQ0NzR0FRVUZCd01DTUJJR0ExVWRFd0VCL3dRSU1BWUJBZjhDQVFBd0hRWURWUjBPQkJZRUZKalIrRzRRNjgrYjdHQ2ZHSkFib090OUNmMHJNQjhHQTFVZEl3UVlNQmFBRkp2aUIxZG5IQjdBYWdiZVdiU2FMZC9jR1lZdU1EVUdDQ3NHQVFVRkJ3RUJCQ2t3SnpBbEJnZ3JCZ0VGQlFjd0FZWVphSFIwY0RvdkwyOWpjM0F1Y0d0cExtZHZiMmN2WjNOeU1qQXlCZ05WSFI4RUt6QXBNQ2VnSmFBamhpRm9kSFJ3T2k4dlkzSnNMbkJyYVM1bmIyOW5MMmR6Y2pJdlozTnlNaTVqY213d1B3WURWUjBnQkRnd05qQTBCZ1puZ1F3QkFnSXdLakFvQmdnckJnRUZCUWNDQVJZY2FIUjBjSE02THk5d2Eya3VaMjl2Wnk5eVpYQnZjMmwwYjNKNUx6QU5CZ2txaGtpRzl3MEJBUXNGQUFPQ0FRRUFHb0ErTm5uNzh5NnBSamQ5WGxRV05hN0hUZ2laL3IzUk5Ha21VbVlIUFFxNlNjdGk5UEVhanZ3UlQyaVdUSFFyMDJmZXNxT3FCWTJFVFV3Z1pRK2xsdG9ORnZoc085dHZCQ09JYXpwc3dXQzlhSjl4anU0dFdEUUg4TlZVNllaWi9YdGVEU0dVOVl6SnFQalk4cTNNRHhyem1xZXBCQ2Y1bzhtdy93SjRhMkc2eHpVcjZGYjZUOE1jRE8yMlBMUkw2dTNNNFR6czNBMk0xajZieWtKWWk4d1dJUmRBdktMV1p1L2F4QlZielltcW13a201ekxTRFc1bklBSmJFTENRQ1p3TUg1NnQyRHZxb2Z4czZCQmNDRklaVVNweHU2eDZ0ZDBWN1N2SkNDb3NpclNtSWF0ai85ZFNTVkRRaWJldDhxLzdVSzR2NFpVTjgwYXRuWnoxeWc9PSJdfQ.eyJub25jZSI6InhnTUdCWVl3aW53dVhrQ2x4OXNYVDdtSWxLMEtodDJaWW5KaGRtVmZibTl1WTJVeE5UUXdORGszTnpJME1ESTIiLCJ0aW1lc3RhbXBNcyI6MTU0MDQ5NzcyNTQ4MCwiYXBrUGFja2FnZU5hbWUiOiJjb20uYnJhdmUuYnJvd3NlciIsImFwa0RpZ2VzdFNoYTI1NiI6IldPRTVQRk9pNjI4UjhRZHAxa3B2UUhMVVNwWUtnWjU2YUZkbFJyTE5UZ3M9IiwiY3RzUHJvZmlsZU1hdGNoIjp0cnVlLCJhcGtDZXJ0aWZpY2F0ZURpZ2VzdFNoYTI1NiI6WyJNcUw4ZE5jeEVGaFo1YWhkOFcyVjhRTFlXeUlKbTRCa3hkaVJYR0hhMGVBPSJdLCJiYXNpY0ludGVncml0eSI6dHJ1ZX0.K39pNLtS7w-jlnNlP1fz31RGH-xP23t_FyInL3FrxNJGQq5oRMpkBGUeE49sOeUJMi8gjYpQR1Ek2-3M8gS_0IwOUFcIXJjAJuLVJHwg_i0hxtgJLRvCAS3ifsfk-UX7HsYKdY1voUsPtZ9ilYLIJCY5Gy5uHqedgznDKyrGYKPMuiMNyfkp88AjN2XA9D2Axqys9s67uEivMF37HUDK_Kqh8uYF276vs9SU7ovedbz7tG1suGUT9zpEDCZBLqdhj2wfdiXphhOZJG2ogMUzp3IOCRLYsfWSha-OQX3UI84cYUG1Ubrqd4mahl5dpkxclkMr-zyFQC5WNCQLO2OA_g'

test('grants: add expired grant and make sure it does not add to wallet', async t => {
  t.plan(10)
  let body, item
  const url = '/v2/grants'
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
    .get('/v2/grants')
    .expect(ok)

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

  ;({ body } = await ledgerAgent.get('/v2/promotions').expect(ok))
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
  t.is(item.protocolVersion, 2)

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
  // const newPromotionId = promotionId + 'nu'
  const where = {
    promotionId,
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
  item = body[0]
  t.true(_.isObject(item))
  t.is(_.keys(item).length, 6)
  t.is(item.promotionId, promotionId)
  t.is(item.active, true)
  t.is(item.count, 0)
  // different for each one
  t.true(_.isNumber(item.minimumReconcileTimestamp))
  t.is(item.priority, 0)
  t.is(item.protocolVersion, 2)
})

test('attestation returns a random value for the same paymentId', async (t) => {
  t.plan(2)

  const paymentId = 'e5d074c7-199f-4a5e-9a81-3460aef128d0'
  const url = `/v1/attestations/${paymentId}`

  const { body } = await ledgerAgent
    .get(url)
    .expect(ok)

  t.true(_.isString(body.nonce))

  const {
    body: second
  } = await ledgerAgent
    .get(url)
    .expect(ok)

  t.not(body.nonce, second.nonce)
})

test('get /v2/grants returns 404 for browser-laptop', async (t) => {
  const browserLaptopUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69 Safari/537.36'
  const braveCoreUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3581.0 Safari/537.36'
  var response = await ledgerAgent
      .get(`/v2/grants`)
      .set('user-agent', browserLaptopUserAgent)
      .expect(404)
  t.is(response.body.message, 'promotion not available for browser-laptop.', 'identifies and rejects browser-laptop')

  response = await ledgerAgent
      .get(`/v2/grants`)
      .set('user-agent', braveCoreUserAgent)
      .expect(404)
  t.not(response.body.message, 'promotion not available for browser-laptop.', 'does not reject browser-laptop')
})

test('claim grants with attestations', async (t) => {
  // t.plan(10)
  t.true(true)
  let body, item, wallet
  const url = '/v2/grants'
  const promotionId = '902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3'
  const grants = {
    'grants': [ 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ' ],
    'promotions': [{
      'protocolVersion': 3,
      'active': true,
      'priority': 0,
      promotionId,
      minimumReconcileTimestamp: 1526941400000
    }]
  }
  await ledgerAgent.post(url).send(grants).expect(ok)

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
    .get('/v3/grants')
    .set('Safetynet-Token', BAT_CAPTCHA_BRAVE_TOKEN)
    .expect(ok)

  const attestationURL = `/v1/attestations/${paymentId}`
  response = await ledgerAgent
    .get(attestationURL)
    .expect(ok)

  const nonce = Buffer.from(response.body.nonce).toString('base64')

  const ledgerDB = await connectToDb('ledger')
  const wallets = ledgerDB.collection('wallets')
  wallet = await wallets.findOne({ paymentId })

  t.not(wallet.nonce, undefined, 'a random nonce was set')
  t.is(wallet.nonce, nonce, 'a random nonce was set on the wallet object')

  await wallets.update({
    paymentId
  }, {
    $set: {
      nonce: 'xgMGBYYwinwuXkClx9sXT7mIlK0Kht2ZYnJhdmVfbm9uY2UxNTQwNDk3NzI0MDI2'
    }
  })

  // request grant
  response = await ledgerAgent
      .put(`/v3/grants/${paymentId}`)
      .set('Safetynet-Token', BAT_CAPTCHA_BRAVE_TOKEN)
      .send({promotionId})
      .expect(ok)

  wallet = await wallets.findOne({ paymentId })
  t.is(wallet.nonce, undefined, 'nonce was unset from wallet object after use')

  ;({ body } = await ledgerAgent
      .get('/v3/promotions')
      .expect(ok))
  t.true(_.isArray(body))
  item = body[0]
  t.true(_.isObject(item))
  t.is(_.keys(item).length, 6)
  t.is(item.promotionId, promotionId)
  t.is(item.active, true)
  t.is(item.count, 0)
  // different for each one
  t.true(_.isNumber(item.minimumReconcileTimestamp))
  t.is(item.priority, 0)
  t.is(item.protocolVersion, 3)

  const donateAmt = new BigNumber(response.body.probi).dividedBy('1e18').toNumber()
  const desired = donateAmt.toString()

  do {
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  var err = ok(response)
  if (err) throw err
  t.is(response.body.balance, '30.0000')
})
