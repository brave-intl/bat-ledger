'use strict'
import parsePrometheusText from 'parse-prometheus-text-format'
import BigNumber from 'bignumber.js'
import UpholdSDK from '@uphold/uphold-sdk-javascript'
import anonize from 'node-anonize2-relic'
import crypto from 'crypto'
import { serial as test } from 'ava'
import tweetnacl from 'tweetnacl'
import uuidV4 from 'uuid/v4'
import { sign } from 'http-request-signature'
import _ from 'underscore'
import dotenv from 'dotenv'
import { agent } from 'supertest'
import {
  timeout,
  uint8tohex,
  justDate
} from 'bat-utils/lib/extras-utils'
import { Runtime } from 'bat-utils'
import {
  signTxn,
  makeSettlement,
  cleanDbs,
  cleanPgDb,
  agents,
  ok,
  status,
  braveYoutubeOwner,
  braveYoutubePublisher,
  createSurveyor,
  setupCreatePayload,
  debug,
  statsUrl,
  connectToDb
} from './utils'
import {
  freezeOldSurveyors
} from '../eyeshade/workers/reports'
import {
  updateBalances
} from '../eyeshade/lib/transaction'

dotenv.config()

const runtime = new Runtime({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  },
  queue: {
    rsmq: process.env.BAT_REDIS_URL
  },
  cache: {
    redis: {
      url: process.env.BAT_REDIS_URL
    }
  },
  prometheus: {
    label: process.env.SERVICE + '.worker.1'
  }
})

const upholdBaseUrls = {
  prod: 'https://api.uphold.com',
  sandbox: 'https://api-sandbox.uphold.com'
}
const environment = process.env.UPHOLD_ENVIRONMENT || 'sandbox'
const uphold = new UpholdSDK({ // eslint-disable-line new-cap
  baseUrl: upholdBaseUrls[environment],
  clientId: 'none',
  clientSecret: 'none'
})
const donorCardId = process.env.UPHOLD_DONOR_CARD_ID

const statsURL = statsUrl()
const balanceURL = '/v1/accounts/balances'
const settlementURL = '/v2/publishers/settlement'

test.afterEach.always(cleanDbs)
test.afterEach.always(cleanPgDb(runtime.postgres))

test('check /metrics is up with no authorization', async (t) => {
  const {
    BAT_BALANCE_SERVER,
    BAT_EYESHADE_SERVER,
    BAT_LEDGER_SERVER
  } = process.env

  await checkMetrics(BAT_EYESHADE_SERVER)
  await checkMetrics(BAT_BALANCE_SERVER)
  await checkMetrics(BAT_LEDGER_SERVER)

  async function checkMetrics (origin) {
    const {
      text
    } = await agent(origin)
      .get('/metrics')
      .expect(ok)
    t.true(_.isArray(parsePrometheusText(text)), 'a set of metrics is sent back')
  }
})

test('ledger : user contribution workflow with uphold BAT wallet', async t => {
  // Create surveyors
  const surveyorId = (await createSurveyor({ rate: 1, votes: 12 })).body.surveyorId

  // Create user wallet
  let response, body
  const [viewingId, keypair, personaCredential, paymentId, userCardId] = await createUserWallet(t)

  // Fund user Uphold wallet
  const amountFunded = await fundUserWalletAndTestStats(t, personaCredential, paymentId, userCardId)

  // Purchase votes
  await sendUserTransaction(t, paymentId, amountFunded, userCardId, donorCardId, keypair, surveyorId, viewingId)
  response = await agents.ledger.stats.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 1,
    contributed: 1,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets: 1
  }])

  // Create voting credentials
  const [surveyorIds, viewingCredential] = await createVotingCredentials(t, viewingId)

  // look up surveyorIds to ensure that they belong to the correct cohorts
  const ledgerDB = await connectToDb('ledger')
  const surveyors = ledgerDB.collection('surveyors')

  let numControlSurveryors = 0
  let numGrantSurveyors = 0
  for (let i = 0; i < surveyorIds.length; i += 1) {
    const surveyorId = surveyorIds[i]
    const cohort = (await surveyors.findOne({ surveyorId: surveyorId })).payload.cohort
    if (cohort === 'control') {
      numControlSurveryors += 1
    } else if (cohort === 'grant') {
      numGrantSurveyors += 1
    }
  }

  t.true(numControlSurveryors === parseInt(amountFunded))
  t.true(numGrantSurveyors === 0)

  // Submit votes
  const channels = [
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
    response = await agents.ledger.global
      .get('/v2/surveyor/voting/' + encodeURIComponent(id) + '/' + viewingCredential.parameters.userId)
      .expect(ok)

    const surveyor = new anonize.Surveyor(response.body)
    response = await agents.ledger.global
      .put('/v2/surveyor/voting/' + encodeURIComponent(id))
      .send({ proof: viewingCredential.submit(surveyor, { publisher: channels[i % channels.length] }) })
      .expect(ok)
  }

  response = await agents.ledger.stats.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 1,
    contributed: 1,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets: 1
  }], 'ensure the created contributions are reflected in stats endpoint')

  // check pending tx endpoint
  body = []
  while (!body.length) {
    await timeout(2000)
    await updateBalances(runtime)
    ;({
      body
    } = await agents.eyeshade.publishers.get(balanceURL)
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
  } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: false,
      account: braveYoutubePublisher
    }))
  t.deepEqual(body, [], 'pending votes are not counted if pending is not true')
  ;({
    body
  } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      account: braveYoutubePublisher
    }))
  t.deepEqual(body, [], 'endpoint defaults pending to false')

  const account = [braveYoutubePublisher]
  const query = { account }

  await freezeOldSurveyors(debug, runtime, -1)

  body = []
  do {
    await timeout(5000)
    await updateBalances(runtime)
    ;({ body } = await agents.eyeshade.publishers
      .get(balanceURL)
      .query(query)
      .expect(ok))
  } while (!body.length)

  t.true(body[0].balance > 0)

  const newYear = new Date('2019-01-01')
  const settlement = makeSettlement('contribution', body[0].balance, {
    executedAt: newYear.toISOString()
  })

  response = await agents.eyeshade.publishers.post(settlementURL).send([settlement]).expect(ok)
  await agents.eyeshade.publishers.post(settlementURL + '/submit').send(response.body).expect(ok)
  do {
    await timeout(5000)
    await updateBalances(runtime)
    ;({ body } = await agents.eyeshade.publishers
      .get(balanceURL)
      .query(query)
      .expect(ok))
  } while (+body[0].balance)

  const { balance } = body[0]
  t.true(balance.length > 1)
  t.is(+balance, 0)

  const select = `
SELECT *
FROM transactions
WHERE
    transaction_type = 'contribution_settlement';
`
  const {
    rows
  } = await runtime.postgres.query(select)

  t.deepEqual(rows.map((entry) => _.omit(entry, ['from_account', 'to_account', 'document_id', 'id'])), [{
    created_at: newYear,
    description: 'payout for contribution',
    transaction_type: 'contribution_settlement',
    from_account_type: 'owner',
    to_account_type: 'uphold',
    amount: '0.950000000000000000',
    channel: braveYoutubePublisher,
    settlement_currency: 'USD',
    settlement_amount: '1.000000000000000000'
  }])

  // ensure referral balances are computed correctly
  let transactions
  const encoded = encodeURIComponent(braveYoutubeOwner)
  const transactionsURL = `/v1/accounts/${encoded}/transactions`
  const referralKey = uuidV4().toLowerCase()
  const referralURL = '/v1/referrals/' + referralKey
  const referral = {
    ownerId: braveYoutubeOwner,
    channelId: braveYoutubePublisher,
    downloadId: uuidV4(),
    platform: 'android',
    finalized: (new Date()).toISOString()
  }
  const referrals = [referral]

  transactions = await getReferrals()
  t.deepEqual(transactions, [])

  await agents.eyeshade.referrals
    .put(referralURL)
    .send(referrals)
    .expect(ok)

  transactions = []
  do {
    await timeout(5000)
    transactions = await getReferrals()
  } while (!transactions.length)

  const [tx] = transactions
  const amount = tx.amount
  t.true(amount.length > 1)
  t.true(amount > 0)

  async function getReferrals () {
    const {
      body: transactions
    } = await agents.eyeshade.publishers
      .get(transactionsURL)
      .expect(ok)
    return transactions.filter(({ transaction_type: type }) => type === 'referral')
  }
})

test('wallets can be claimed by verified members', async (t) => {
  const ledgerDB = await connectToDb('ledger')
  const wallets = ledgerDB.collection('wallets')

  await createSurveyor({ rate: 1, votes: 1 })

  const anonCardInfo1 = await createAndFundUserWallet()
  const anonCardInfo2 = await createAndFundUserWallet()
  const anonCardInfo3 = await createAndFundUserWallet()
  const anonCardInfo4 = await createAndFundUserWallet()
  const settlement = process.env.BAT_SETTLEMENT_ADDRESS

  const anonCard1AnonAddr = await createAnonymousAddress(anonCardInfo1.providerId)
  const anonCard2AnonAddr = await createAnonymousAddress(anonCardInfo2.providerId)

  await claimCard(anonCardInfo1, settlement)

  await claimCard(anonCardInfo2, anonCardInfo1.providerId, 200, '0', anonCard1AnonAddr.id)
  await claimCard(anonCardInfo2, anonCardInfo1.providerId)
  let wallet = await wallets.findOne({ paymentId: anonCardInfo2.paymentId })
  t.deepEqual(wallet.anonymousAddress, anonCard1AnonAddr.id)

  await claimCard(anonCardInfo3, anonCardInfo2.providerId)
  wallet = await wallets.findOne({ paymentId: anonCardInfo3.paymentId })
  t.false(!!wallet.anonymousAddress)

  await claimCard(anonCardInfo4, anonCardInfo3.providerId, 409)

  // redundant calls are fine provided the amount we are attempting to transfer is less than the balance
  // furthermore if the anonymous address has not previously been set it can be now
  await claimCard(anonCardInfo3, anonCardInfo2.providerId, 200, '0', anonCard2AnonAddr.id)
  wallet = await wallets.findOne({ paymentId: anonCardInfo3.paymentId })
  t.deepEqual(wallet.anonymousAddress, anonCard2AnonAddr.id)

  async function createAnonymousAddress (providerId) {
    return uphold.createCardAddress(providerId, 'anonymous')
  }

  async function claimCard (anonCard, destination, code = 200, amount = anonCardInfo1.amount, anonymousAddress) {
    const txn = {
      destination,
      denomination: {
        currency: 'BAT',
        // amount should be same for this example
        amount
      }
    }
    const body = { signedTx: signTxn(anonCard.keypair, txn) }
    if (anonymousAddress) {
      _.extend(body, { anonymousAddress })
    }
    await agents.ledger.global
      .post(`/v2/wallet/${anonCard.paymentId}/claim`)
      .send(body)
      .expect(status(code))
  }

  async function createAndFundUserWallet () {
    // Create user wallet
    const [viewingId, keypair, personaCredential, paymentId, userCardId] = await createUserWallet(t) // eslint-disable-line
    // Fund user uphold wallet
    const amountFunded = await fundUserWallet(t, personaCredential, paymentId, userCardId)
    return {
      keypair,
      amount: amountFunded,
      providerId: userCardId,
      paymentId
    }
  }
})

async function createUserWallet (t) {
  const personaId = uuidV4().toLowerCase()
  const viewingId = uuidV4().toLowerCase()
  let response

  response = await agents.ledger.global.get('/v2/registrar/persona').expect(ok)
  t.true(_.isString(response.body.registrarVK))
  const personaCredential = new anonize.Credential(personaId, response.body.registrarVK)
  const keypair = tweetnacl.sign.keyPair()
  const body = {
    label: uuidV4().toLowerCase(),
    currency: 'BAT',
    publicKey: uint8tohex(keypair.publicKey)
  }
  const octets = JSON.stringify(body)
  const headers = {
    digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
  }
  headers.signature = sign({
    headers: headers,
    keyId: 'primary',
    secretKey: uint8tohex(keypair.secretKey)
  }, { algorithm: 'ed25519' })
  const payload = {
    requestType: 'httpSignature',
    request: {
      body: body,
      headers: headers,
      octets: octets
    },
    proof: personaCredential.request()
  }

  response = await agents.ledger.global.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)

  t.true(_.isString(response.body.wallet.paymentId))
  t.true(_.isString(response.body.verification))
  t.true(_.isString(response.body.wallet.addresses.BAT))
  t.true(_.isString(response.body.wallet.addresses.BTC))
  t.true(_.isString(response.body.wallet.addresses.CARD_ID))
  t.true(_.isString(response.body.wallet.addresses.ETH))
  t.true(_.isString(response.body.wallet.addresses.LTC))

  const paymentId = response.body.wallet.paymentId
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)

  response = await agents.ledger.global.get('/v2/wallet?publicKey=' + uint8tohex(keypair.publicKey))
    .expect(ok)

  t.true(response.body.paymentId === paymentId)

  return [viewingId, keypair, personaCredential, paymentId, userCardId]
}

async function getSurveyorContributionAmount (t, personaCredential) {
  const response = await agents.ledger.global
    .get('/v2/surveyor/contribution/current/' + personaCredential.parameters.userId)
    .expect(ok)

  t.true(_.isString(response.body.surveyorId))
  t.true(_.isString(response.body.payload.adFree.probi))

  const donateAmt = new BigNumber(response.body.payload.adFree.probi).dividedBy('1e18').toNumber()
  return donateAmt
}

async function waitForContributionAmount (t, paymentId, donateAmt) {
  let response
  do { // This depends on currency conversion rates being available, retry until they are available
    response = await agents.ledger.global
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503)
  const err = ok(response)
  if (err) throw err

  t.true(_.isString(response.body.balance))
  t.true(_.isString(response.body.httpSigningPubKey))
  t.is(response.body.balance, '0.0000')

  return donateAmt.toFixed(4).toString()
}

async function fundUserWallet (t, personaCredential, paymentId, userCardId) {
  const donateAmt = await getSurveyorContributionAmount(t, personaCredential)
  const desiredTxAmt = await waitForContributionAmount(t, paymentId, donateAmt)
  await createCardTransaction(desiredTxAmt, userCardId)
  return desiredTxAmt
}

async function fundUserWalletAndTestStats (t, personaCredential, paymentId, userCardId) {
  let response
  const donateAmt = await getSurveyorContributionAmount(t, personaCredential)

  response = await agents.ledger.stats.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 0,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 1,
    contributed: 0,
    wallets: 1
  }])

  const desiredTxAmt = await waitForContributionAmount(t, paymentId, donateAmt)

  response = await agents.ledger.stats.get(statsURL).expect(ok)
  t.deepEqual(response.body, [{
    activeGrant: 0,
    anyFunds: 1,
    contributed: 0,
    created: justDate(new Date()),
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets: 1
  }])

  await createCardTransaction(desiredTxAmt, userCardId)

  return desiredTxAmt
}

async function createCardTransaction (desiredTxAmt, userCardId) {
  // have to do some hacky shit to use a personal access token
  uphold.storage.setItem('uphold.access_token', process.env.UPHOLD_ACCESS_TOKEN)

  await uphold.createCardTransaction(donorCardId,
    { amount: desiredTxAmt, currency: 'BAT', destination: userCardId },
    true // commit tx in one swoop
  )
}

async function sendUserTransaction (t, paymentId, txAmount, userCardId, donorCardId, keypair, surveyorId, viewingId) {
  let response, err
  do {
    response = await agents.ledger.global
      .get(`/v2/wallet/${paymentId}?refresh=true&amount=${txAmount}&altcurrency=BAT`)
    if (response.status === 503) await timeout(response.headers['retry-after'] * 1000)
    else if (response.body.balance === '0.0000') await timeout(500)
  } while (response.status === 503 || response.body.balance === '0.0000')
  err = ok(response)
  if (err) throw err

  const balanceBefore = new BigNumber(await getLedgerBalance(paymentId))

  t.is(Number(response.body.unsignedTx.denomination.amount), Number(txAmount))
  const { rates } = response.body
  t.true(_.isObject(rates))
  t.true(_.isNumber(rates.BTC))
  t.true(_.isNumber(rates.ETH))
  t.true(_.isNumber(rates.LTC))
  t.true(_.isNumber(rates.USD))
  t.true(_.isNumber(rates.EUR))

  // ensure that transactions out of the restricted user card require a signature
  // by trying to send back to the donor card
  await t.throwsAsync(uphold.createCardTransaction(userCardId,
    { amount: txAmount, currency: 'BAT', destination: donorCardId },
    true // commit tx in one swoop
  ))

  const createPayload = setupCreatePayload({
    viewingId,
    surveyorId,
    keypair
  })
  const { unsignedTx } = response.body
  const { denomination, destination } = unsignedTx
  const { currency, amount } = denomination

  const tooLowPayload = createPayload({
    destination,
    denomination: {
      amount: 0.1,
      currency
    }
  })
  await agents.ledger.global
    .put('/v2/wallet/' + paymentId)
    .send(tooLowPayload)
    .expect(416)

  const notSettlementAddressPayload = createPayload({
    destination: uuidV4(),
    denomination: {
      amount,
      currency
    }
  })
  await agents.ledger.global
    .put('/v2/wallet/' + paymentId)
    .send(notSettlementAddressPayload)
    .expect(422)

  const justRightPayload = createPayload(unsignedTx)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await agents.ledger.global
      .put('/v2/wallet/' + paymentId)
      .send(justRightPayload)
  } while (response.status === 503)
  err = ok(response)
  if (err) throw err

  const balanceAfter = new BigNumber(await getLedgerBalance(paymentId))
  t.true(balanceBefore.greaterThan(balanceAfter))
  t.is(0, +balanceAfter.toString())

  t.false(_.isString(response.body.satoshis))
  t.true(_.isString(response.body.altcurrency))
  t.true(_.isString(response.body.probi))

  return justRightPayload
}

async function getLedgerBalance (paymentId) {
  const { body } = await agents.ledger.global
    .get(`/v2/wallet/${paymentId}`)
    .query({
      refresh: true
    })
    .expect(ok)
  return body.probi
}

async function createVotingCredentials (t, viewingId) {
  let response
  response = await agents.ledger.global
    .get('/v2/registrar/viewing')
    .expect(ok)

  t.true(_.isString(response.body.registrarVK))
  const viewingCredential = new anonize.Credential(viewingId, response.body.registrarVK)

  do { // Contribution surveyor creation is handled asynchonously, this API will return 503 until ready
    if (response.status === 503) {
      await timeout(response.headers['retry-after'] * 1000)
    }
    response = await agents.ledger.global
      .post('/v2/registrar/viewing/' + viewingCredential.parameters.userId)
      .send({ proof: viewingCredential.request() })
  } while (response.status === 503)
  const err = ok(response)
  if (err) throw err

  const surveyorIds = response.body.surveyorIds
  t.true(surveyorIds.length >= 5)
  viewingCredential.finalize(response.body.verification)

  return [surveyorIds, viewingCredential]
}
