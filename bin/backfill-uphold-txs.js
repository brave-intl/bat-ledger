const UpholdSDK = require('@uphold/uphold-sdk-javascript')
const { upholdBaseUrls } = require('bat-utils/lib/runtime-wallet')
const SDebug = require('sdebug')
const _ = require('underscore')
const {
  knownChains,
  insertUserDepositFromChain
} = require('../eyeshade/lib/transaction')
const { Runtime } = require('bat-utils')
const config = require('../config')
const debug = new SDebug('backfill-uphold-txs')
const runtime = new Runtime(config)
// const chainKeys = _.keys(knownChains)
const connection = runtime.postgres.connect()
run().catch((err) => {
  debug(err)
}).then(async () => {
  const client = await connection
  await runtime.shutdown()
  await client.release()
  debug('shutting down')
  process.exit(0)
})

async function run () {
  const walletsCollection = runtime.database.get('wallets', debug)
  const client = await connection
  const wallets = await walletsCollection.find({
    providerId: {
      $nin: ['', null]
    }
  }, {
    providerId: 1
  })
  debug('wallets length', wallets.length)
  for (let wallet of wallets) {
    const {
      providerId: cardId
    } = wallet
    if (!cardId) {
      continue
    }
    const uphold = createUpholdSDK(config.uphold.accessToken)
    const addresses = await uphold.getCardAddresses(cardId)
    const txsPaginator = await uphold.getTransactions()
    let nextPage = txsPaginator
    while (nextPage) {
      const txs = await txsPaginator.getPage()
      for (let tx of txs) {
        await insertTransaction(runtime, client, cardId, addresses, tx)
      }
      nextPage = await txsPaginator.nextPage()
    }
  }
}

async function insertTransaction (runtime, client, cardId, addresses, tx) {
  const {
    id,
    createdAt,
    currency: chain,
    // destination,
    denomination
  } = tx
  const chainType = knownChains[chain]
  const {
    formats
  } = _.find(addresses, ({ type }) => type === chainType)
  const format = formats[0]
  const {
    value: address
  } = format
  const {
    // currency,
    amount
  } = denomination
  const input = {
    id,
    chain,
    cardId,
    amount,
    address,
    createdAt
  }
  debug('transaction', input)
  if (!chainType) {
    return
  }
  await insertUserDepositFromChain(runtime, client, input)
}

function createUpholdSDK (token) {
  const options = {
    baseUrl: upholdBaseUrls[config.uphold.environment],
    clientId: config.uphold.clientId,
    clientSecret: config.uphold.clientSecret
  }
  const uphold = new UpholdSDK.default(options) // eslint-disable-line new-cap
  uphold.storage.setItem(uphold.options.accessTokenKey, token)
  return uphold
}
