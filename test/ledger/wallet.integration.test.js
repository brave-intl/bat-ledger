import {
  serial as test
} from 'ava'
import BigNumber from 'bignumber.js'
import UpholdSDK from '@uphold/uphold-sdk-javascript'
import crypto from 'crypto'
import anonize from 'node-anonize2-relic'
import { v4 } from 'uuid'
import { sign } from 'http-request-signature'
import tweetnacl from 'tweetnacl'
import {
  ledgerAgent,
  ok,
  status,
  createSurveyor,
  connectToDb,
  cleanDbs
} from '../utils'
import {
  timeout,
  uint8tohex
} from 'bat-utils/lib/extras-utils'
import _ from 'underscore'
import whitelist from 'bat-utils/lib/hapi-auth-whitelist'
import Runtime from 'bat-utils/boot-runtime'
const config = require('../../config')
const runtime = new Runtime(config)

test.after(cleanDbs)

test('wallet: make sure out of sync grants are rejected on ledger', async t => {
  t.plan(0)
  var paymentId, walletInfo
  const ledger = await connectToDb('ledger')
  const url = '/v1/grants'
  var { surveyorId } = await createSurveyor({
    probi: (new BigNumber(30)).times(1e18).toString()
  })
  const promotionId = '7a95ab95-7742-40f7-9e82-016c6c7a5c53'
  const grants = ['eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI4MGM0YTk3Yy05Y2Q1LTQzZWYtOWZlZC04ZTQ3MmQwOTkzNDkiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI3YTk1YWI5NS03NzQyLTQwZjctOWU4Mi0wMTZjNmM3YTVjNTMiLCJtYXR1cml0eVRpbWUiOjE1MzI3MjI5NTQsImV4cGlyeVRpbWUiOjE1NDcyNDE3NTR9.FdipGvBgZWorgRm4Dn25qow-ugPhp3XijIcQXIeg8voe4_v2HE1HHvpdfKSXkuwtgW09xgKrglpcipK7CFnCBQ', 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJjMmNjNGExZi1lZDg1LTRhMWUtOWY0My0xMzYxYmE4YTRhODIiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI3YTk1YWI5NS03NzQyLTQwZjctOWU4Mi0wMTZjNmM3YTVjNTMiLCJtYXR1cml0eVRpbWUiOjE1MzI3MjI5NTQsImV4cGlyeVRpbWUiOjE1NDcyNDE3NTR9.7az0PtAGoco70HO3mqX4Yh9xDpL0iTFK5C0g-Dm_w8RLS0K6F5TMEiOszXyFYjY3krg-BYgjddqUgcTN0R9SBg']
  const expired = {grants, 'promotions': [{promotionId, 'priority': 0, 'active': true, 'minimumReconcileTimestamp': 1532722954000}]}
  await ledgerAgent.post(url).send(expired).expect(ok)

  const personaId = v4().toLowerCase()
  const viewingId = v4().toLowerCase()
  let response, octets, headers, payload, err

  response = await ledgerAgent.get('/v2/registrar/persona').expect(ok)
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)

  const keypair = tweetnacl.sign.keyPair()

  const body = {
    label: v4().toLowerCase(),
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
  paymentId = response.body.wallet.paymentId
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)

  response = await ledgerAgent.get('/v2/wallet?publicKey=' + uint8tohex(keypair.publicKey))
    .expect(ok)

  response = await ledgerAgent
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)

  surveyorId = response.body.surveyorId

  const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()

  const desired = donateAmt.toFixed(4).toString()

  do { // This depends on currency conversion rates being available, retry until then are available
    response = await ledgerAgent
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${desired}&currency=USD`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

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

  octets = JSON.stringify(response.body.unsignedTx)
  headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }

  headers['signature'] = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })

  const signedTx = {
    body: body,
    headers: headers,
    octets: octets
  }

  payload = {
    requestType: 'httpSignature',
    surveyorId,
    viewingId,
    signedTx
  }

  const request = {
    info: {
      remoteAddress: '172.18.0.11'
    },
    headers: {
      'user-agent': 'node-superagent/3.8.3'
    }
  }

  response = await ledgerAgent.put(`${url}/${paymentId}`).send({ promotionId }).expect(ok)
  ;({
    body: walletInfo
  } = response)

  walletInfo = await tieWalletToGrants()
  await runtime.wallet.redeem(walletInfo, walletInfo.unsignedTx, signedTx, request)

  response = await ledgerAgent
    .put('/v2/wallet/' + paymentId)
    .send(payload)
    .expect(status(410))

  response = await ledgerAgent
    .put('/v2/wallet/' + paymentId)
    .send(payload)
    .expect(ok)

  async function tieWalletToGrants () {
    const grants = ledger.collection('grants')
    const wallets = ledger.collection('wallets')
    let query
    query = { status: 'active', promotionId }
    // pop off one grant
    const grant = await grants.findOne(query)
    await grants.findOneAndDelete(query)
    const grantInfo = _.extend(_.pick(grant, ['token', 'grantId', 'promotionId', 'status']),
      { claimTimestamp: Date.now(), claimIP: whitelist.ipaddr(request) }
    )

    // atomic find & update, only one request is able to add a grant for the given promotion to this wallet
    query = { 'paymentId': paymentId, 'grants.promotionId': { '$ne': promotionId } }
    await wallets.findOneAndUpdate(query,
                            { $push: { grants: grantInfo } }
    )
    const wallet = await wallets.findOne({ paymentId })
    wallet.requestType = 'httpSignature'
    return wallet
  }
})
