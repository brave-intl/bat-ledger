'use strict'
const parsePrometheusText = require('parse-prometheus-text-format')
const { serial: test } = require('ava')
const {
  default: UpholdSDK
} = require('@uphold/uphold-sdk-javascript')
const { freezeOldSurveyors } = require('../eyeshade/workers/reports')
const uuidV4 = require('uuid/v4')
const _ = require('underscore')
const dotenv = require('dotenv')
const { agent } = require('supertest')
const tweetnacl = require('tweetnacl')
const anonize = require('node-anonize2-relic')
const crypto = require('crypto')
const { sign } = require('http-request-signature')
const { Runtime } = require('bat-utils')
const Kafka = require('bat-utils/lib/runtime-kafka')
const {
  timeout,
  BigNumber,
  uint8tohex
} = require('bat-utils/lib/extras-utils')
const {
  connectToDb,
  agents,
  signTxn,
  status,
  cleanDbs,
  setupForwardingServer,
  braveYoutubePublisher,
  debug,
  makeSettlement,
  ok
} = require('./utils')

const {
  routes: grantsRoutes,
  initialize: grantsInitializer
} = require('../ledger/controllers/grants')
const {
  routes: registrarRoutes,
  initialize: registrarInitializer
} = require('../ledger/controllers/registrar')
const {
  routes: walletRoutes,
  initialize: walletInitializer
} = require('../ledger/controllers/wallet')
const suggestions = require('../eyeshade/lib/suggestions')

dotenv.config()

const donorCardId = process.env.UPHOLD_DONOR_CARD_ID
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

test.before(async (t) => {
  const ledgerDB = await connectToDb('ledger')
  const wallets = ledgerDB.collection('wallets')
  const surveyors = ledgerDB.collection('surveyors')
  const runtimeConfig = Object.assign({}, require('../config'), {
    queue: process.env.BAT_REDIS_URL,
    postgres: {
      url: process.env.BAT_POSTGRES_URL
    }
  })
  const runtime = new Runtime(runtimeConfig)
  _.extend(t.context, {
    runtime,
    wallets,
    surveyors,
    ledger: agents.ledger.global
  })
})

test.beforeEach(cleanDbs)

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

test('publisher accounts are filled with votes and transactions at appropriate times', async t => {
  // check pending tx endpoint
  const topic = process.env.ENV + '.grant.suggestion'
  let body
  const balanceURL = '/v1/accounts/balances'
  const settlementURL = '/v2/publishers/settlement'
  const promotion = uuidV4()
  const { runtime } = t.context
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  const example = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel: braveYoutubePublisher,
    createdAt: (new Date()).toISOString(),
    totalAmount: '1',
    funding: [
      {
        type: 'ugp',
        amount: '1',
        cohort: 'control',
        promotion
      }
    ]
  }
  ;({ body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: braveYoutubePublisher
    }).expect(ok))
  t.is(body.length, 0)

  await producer.send(topic, suggestions.typeV1.toBuffer(example))

  body = []
  while (!body.length) {
    await timeout(1000)
    ;({
      body
    } = await agents.eyeshade.publishers.get(balanceURL)
      .query({
        pending: true,
        account: braveYoutubePublisher
      })
      .expect(ok))
  }
  // no transactions have been input yet
  t.is(null, await getPublisherAccountBalance(runtime, [braveYoutubePublisher]))
  // channel only counts toward pending
  t.deepEqual(body, [{
    account_id: braveYoutubePublisher,
    account_type: 'channel',
    balance: '1.000000000000000000'
  }], 'pending votes show up after small delay')
  const pendingBalances = body
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
  await runtime.postgres.query(`
  update surveyor_groups set created_at = (current_date - interval '1d')`)
  await freezeOldSurveyors(debug, runtime, -1)

  body = []
  do {
    await timeout(1000)
    ;({ body } = await agents.eyeshade.publishers
      .get(balanceURL)
      .query(query)
      .expect(ok))
  } while (!body.length)

  // transactions have now been input and balance will match the one returned from balances endpoint
  const insertedTransactions = await getPublisherAccountBalance(runtime, account)
  t.is(body[0].balance, insertedTransactions)
  t.is(pendingBalances[0].balance, insertedTransactions)
  t.true(body[0].balance > 0)

  const newYear = new Date('2019-01-01')
  const settlement = makeSettlement('contribution', body[0].balance, {
    executedAt: newYear.toISOString()
  })

  const response = await agents.eyeshade.publishers.post(settlementURL).send([settlement]).expect(ok)
  await agents.eyeshade.publishers.post(settlementURL + '/submit').send(response.body).expect(ok)
  do {
    await timeout(1000)
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

  t.deepEqual(rows.map((entry) => _.omit(entry, ['from_account', 'to_account', 'document_id', 'id', 'inserted_at'])), [{
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
})

// allows us to use legacy version
test('wallets can be claimed by verified members', runLegacyWalletClaimTests)

test('wallets can be claimed by verified members using migrated endpoints', async (t) => {
  // allows us to use legacy version
  const {
    agent,
    server,
    runtime
  } = await setupForwardingServer({
    token: null,
    routes: [].concat(grantsRoutes, registrarRoutes, walletRoutes),
    initers: [grantsInitializer, registrarInitializer, walletInitializer],
    config: {
      postgres: {
        url: process.env.BAT_WALLET_MIGRATION_POSTGRES_URL
      },
      forward: {
        wallets: '1'
      },
      wreck: {
        rewards: {
          baseUrl: process.env.BAT_REWARD_SERVER,
          headers: {
            'Content-Type': 'application/json'
          }
        },
        walletMigration: {
          baseUrl: process.env.BAT_WALLET_MIGRATION_SERVER,
          headers: {
            Authorization: 'Bearer ' + (process.env.WALLET_MIGRATION_TOKEN || '00000000-0000-4000-0000-000000000000'),
            'Content-Type': 'application/json'
          }
        }
      }
    }
  })
  t.context.runtime = runtime
  t.context.ledger = agent

  await runWalletClaimTests(t)
  await server.stop({ timeout: 0 })
})

async function runLegacyWalletClaimTests (t) {
  const surveyorId = await createSurveyor(t, {
    rate: 1,
    votes: 1
  })
  const anonCardInfo1 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo2 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo3 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo4 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo5 = await createAndFundUserWallet(t, surveyorId)
  const settlement = process.env.BAT_SETTLEMENT_ADDRESS

  const anonCard1AnonAddr = await createAnonymousAddress(anonCardInfo1.providerId)
  const anonCard2AnonAddr = await createAnonymousAddress(anonCardInfo2.providerId)

  await claimCard(t, anonCardInfo1, settlement, 200, '0')

  await claimCard(t, anonCardInfo2, anonCardInfo1.providerId, 200, '0', anonCard1AnonAddr.id)
  await claimCard(t, anonCardInfo2, anonCardInfo1.providerId, 200, anonCardInfo1.amount)
  let wallet = await t.context.wallets.findOne({ paymentId: anonCardInfo2.paymentId })
  t.deepEqual(wallet.anonymousAddress, anonCard1AnonAddr.id)

  await claimCard(t, anonCardInfo3, anonCardInfo2.providerId, 200, anonCardInfo1.amount)
  wallet = await t.context.wallets.findOne({ paymentId: anonCardInfo3.paymentId })
  t.false(!!wallet.anonymousAddress)

  await claimCard(t, anonCardInfo4, anonCardInfo3.providerId, 200, anonCardInfo1.amount)

  await claimCard(t, anonCardInfo5, anonCardInfo4.providerId, 409, anonCardInfo1.amount)

  // redundant calls are fine provided the amount we are attempting to transfer is less than the balance
  // furthermore if the anonymous address has not previously been set it can be now
  await claimCard(t, anonCardInfo3, anonCardInfo2.providerId, 200, '0', anonCard2AnonAddr.id)
  wallet = await t.context.wallets.findOne({ paymentId: anonCardInfo3.paymentId })
  t.deepEqual(wallet.anonymousAddress, anonCard2AnonAddr.id)
}

async function runWalletClaimTests (t) {
  const surveyorId = await createSurveyor(t, {
    rate: 1,
    votes: 1
  })
  const anonCardInfo1 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo2 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo3 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo4 = await createAndFundUserWallet(t, surveyorId)
  const anonCardInfo5 = await createAndFundUserWallet(t, surveyorId)
  const settlement = process.env.BAT_SETTLEMENT_ADDRESS

  const anonCard1AnonAddr = await createAnonymousAddress(anonCardInfo1.providerId)
  const anonCard2AnonAddr = await createAnonymousAddress(anonCardInfo2.providerId)

  await claimCard(t, anonCardInfo1, settlement, 200, '0', anonCard1AnonAddr.id)

  await claimCard(t, anonCardInfo2, anonCardInfo1.providerId, 200, '0', anonCard1AnonAddr.id)
  await claimCard(t, anonCardInfo2, anonCardInfo1.providerId, 200, anonCardInfo1.amount, anonCard1AnonAddr.id)
  // const wallet = await getWalletFromMigration(anonCardInfo2.paymentId)
  // t.deepEqual(wallet.anonymousAddress, anonCard1AnonAddr.id)

  await claimCard(t, anonCardInfo3, anonCardInfo2.providerId, 200, anonCardInfo1.amount, anonCard1AnonAddr.id)

  await claimCard(t, anonCardInfo4, anonCardInfo3.providerId, 200, anonCardInfo1.amount, anonCard1AnonAddr.id)

  await claimCard(t, anonCardInfo5, anonCardInfo4.providerId, 409, anonCardInfo1.amount, anonCard1AnonAddr.id)

  // redundant calls are fine provided the amount we are attempting to transfer is less than the balance
  // furthermore if the anonymous address has not previously been set it can be now
  await claimCard(t, anonCardInfo3, anonCardInfo2.providerId, 200, '0', anonCard2AnonAddr.id)
}

async function createAnonymousAddress (providerId) {
  return uphold.createCardAddress(providerId, 'anonymous')
}

async function claimCard (t, anonCard, destination, code, amount, anonymousAddress) {
  const txn = {
    denomination: {
      amount,
      currency: 'BAT'
      // amount should be same for this example
    },
    destination
  }
  const body = { signedTx: signTxn(anonCard.keypair, txn) }
  if (anonymousAddress) {
    _.extend(body, { anonymousAddress })
  }
  await t.context.ledger
    .post(`/v2/wallet/${anonCard.paymentId}/claim`)
    .send(body)
    .expect(status(code))
}

async function createAndFundUserWallet (t, surveyorId) {
  // Create user wallet
  const [viewingId, keypair, personaCredential, paymentId, userCardId] = await createUserWallet(t) // eslint-disable-line
  // Fund user uphold wallet
  const amountFunded = await fundUserWallet(t, surveyorId, paymentId, userCardId)
  return {
    keypair,
    amount: amountFunded,
    providerId: userCardId,
    paymentId
  }
}

async function createSurveyor (t, payload) {
  const surveyorId = uuidV4()
  await t.context.surveyors.updateOne({
    surveyorId
  }, {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: {
      surveyorType: 'contribution',
      active: false,
      available: true,
      payload
    }
  }, { upsert: true })
  return surveyorId
}

async function createUserWallet (t) {
  const personaId = uuidV4().toLowerCase()
  const viewingId = uuidV4().toLowerCase()
  let response

  response = await t.context.ledger.get('/v2/registrar/persona').expect(ok)
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

  response = await t.context.ledger.post('/v2/registrar/persona/' + personaCredential.parameters.userId)
    .send(payload).expect(ok)

  t.true(_.isString(response.body.wallet.paymentId))
  t.true(_.isString(response.body.verification))
  // t.true(_.isString(response.body.wallet.addresses.BAT))
  // t.true(_.isString(response.body.wallet.addresses.BTC))
  t.true(_.isString(response.body.wallet.addresses.CARD_ID))
  // t.true(_.isString(response.body.wallet.addresses.ETH))
  // t.true(_.isString(response.body.wallet.addresses.LTC))

  const paymentId = response.body.wallet.paymentId
  const userCardId = response.body.wallet.addresses.CARD_ID

  personaCredential.finalize(response.body.verification)

  response = await t.context.ledger.get('/v2/wallet?publicKey=' + uint8tohex(keypair.publicKey))
    .expect(ok)

  t.is(response.body.paymentId, paymentId, 'payment ids should match')

  return [viewingId, keypair, personaCredential, paymentId, userCardId]
}

async function fundUserWallet (t, surveyorId, paymentId, userCardId) {
  const donateAmt = await getSurveyorContributionAmount(t, surveyorId)
  const desiredTxAmt = await waitForContributionAmount(t, paymentId, donateAmt)
  await createCardTransaction(desiredTxAmt, userCardId)
  return desiredTxAmt
}

async function waitForContributionAmount (t, paymentId, donateAmt) {
  let response
  do { // This depends on currency conversion rates being available, retry until they are available
    response = await t.context.ledger
      .get('/v2/wallet/' + paymentId + '?refresh=true&amount=1&currency=USD')
    if (response.status === 503 || response.status === 429) await timeout(response.headers['retry-after'] * 1000)
  } while (response.status === 503 || response.status === 429)
  const err = ok(response)
  if (err) throw err

  t.true(_.isString(response.body.balance))
  t.true(_.isString(response.body.httpSigningPubKey))
  t.is(response.body.balance, '0.0000')

  return donateAmt.toFixed(4).toString()
}

async function getSurveyorContributionAmount (t, surveyorId) {
  const surveyor = await t.context.surveyors.findOne({ surveyorId })
  const probi = new BigNumber(surveyor.payload.votes).times(surveyor.payload.rate).times(1e18)
  const donateAmt = new BigNumber(probi).dividedBy('1e18').toNumber()
  return donateAmt
}

async function createCardTransaction (desiredTxAmt, userCardId) {
  // have to do some hacky shit to use a personal access token
  uphold.storage.setItem('uphold.access_token', process.env.UPHOLD_ACCESS_TOKEN)

  await uphold.createCardTransaction(donorCardId,
    { amount: desiredTxAmt, currency: 'BAT', destination: userCardId },
    true // commit tx in one swoop
  )
}

async function getPublisherAccountBalance (runtime, accountIds) {
  const { rows } = await runtime.postgres.query(`
  select * from account_balances
  where account_id = any($1::text[])`, [accountIds])
  const row = rows[0]
  return row ? row.balance : null
}
