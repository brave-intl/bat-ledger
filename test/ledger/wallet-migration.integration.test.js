const {
  serial: test
} = require('ava')
const uuidV4 = require('uuid/v4')
const underscore = require('underscore')
const {
  ok,
  cleanDbs,
  setupForwardingServer
} = require('../utils')
const {
  routes: grantsRoutes,
  initialize: grantsInitializer
} = require('../../ledger/controllers/grants')
const {
  routes: registrarRoutes,
  initialize: registrarInitializer
} = require('../../ledger/controllers/registrar')
const {
  routes: walletRoutes,
  initialize: walletInitializer
} = require('../../ledger/controllers/wallet')

test.beforeEach(cleanDbs)

test.before(async (t) => {
  const {
    agent,
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
})

test('wallet endpoint returns default tip choices', async (t) => {
  const paymentId = uuidV4().toLowerCase()
  const publicKey = '5811b31fb2823e63925895e3a041b31fccf0f351b87c3057d2fd2ee744ba6409'
  const providerId = '8c8e3b38-10dd-420d-a3a9-288a47b0999b'
  await insertWallet(t, {
    paymentId,
    provider: 'uphold',
    providerId,
    publicKey
  })

  const {
    body
  } = await t.context.ledger.get(`/v2/wallet/${paymentId}`).expect(ok)

  t.true(underscore.isNumber(body.rates.BAT), 'a value is returned: ' + body.rates.BAT)
  t.deepEqual(body, {
    altcurrency: 'BAT',
    paymentStamp: 0,
    httpSigningPubKey: publicKey,
    addresses: {
      CARD_ID: providerId
    },
    parameters: body.parameters,
    rates: {
      BAT: body.rates.BAT
    },
    balance: '0',
    cardBalance: '0',
    probi: '0',
    unconfirmed: '0'
  }, 'body should be knowable')

  const {
    body: info
  } = await t.context.ledger.get(`/v2/wallet/${paymentId}/info`).expect(ok)
  t.deepEqual(info, {
    altcurrency: 'BAT',
    provider: 'uphold',
    providerId,
    paymentId,
    httpSigningPubKey: publicKey,
    addresses: {
      CARD_ID: providerId
    },
    anonymousAddress: null
  })
})

function insertWallet (t, options) {
  return t.context.runtime.postgres.query(`
  insert into wallets(id, provider, provider_id, public_key)
  values($1, $2, $3, $4)`, [
    options.paymentId,
    options.provider,
    options.providerId,
    options.publicKey
  ])
}
