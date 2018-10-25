'use strict'

import {
  serial as test
} from 'ava'
import _ from 'underscore'
import uuidV4 from 'uuid/v4'
import owners from '../../eyeshade/lib/owners'
import Runtime from 'bat-utils/boot-runtime'
import {
  eyeshadeAgent,
  publisherId,
  braveYoutubeOwner,
  cleanEyeshadeDb,
  cleanDbs,
  ok,
  dbUri,
  status
} from '../utils'

const collections = ['owners', 'publishers', 'tokens']
const SCOPE = 'cards:read user:read'

const {
  UPHOLD_ACCESS_TOKEN,
  BAT_POSTGRES_URL
} = process.env

const mongoURL = dbUri('eyeshade')
const runtime = new Runtime({
  database: mongoURL,
  postgres: {
    url: BAT_POSTGRES_URL
  }
})

test.after.always(cleanDbs)
test.beforeEach(async (t) => {
  const db = await cleanEyeshadeDb(collections)
  collections.forEach((name) => {
    t.context[name] = db.collection(name)
  })
})

test('owners can be created', async (t) => {
  t.plan(15)
  const owner = createOwnerInfos()
  const payload = {
    provider: 'uphold',
    show_verification_status: false,
    parameters: {
      scope: SCOPE,
      access_token: UPHOLD_ACCESS_TOKEN
    }
  }

  t.is(await owners.countByOwner(runtime, owner.key), '0', 'sanity')

  await eyeshadeAgent
    .get(owner.urls.root)
    .expect(status(404))

  await eyeshadeAgent
    .put(owner.urls.root)
    .send(payload)
    .expect(ok)

  t.is(await owners.countByOwner(runtime, owner.key), '1', 'can add owner')

  let ownerObject = await owners.readByOwner(runtime, owner.key)
  t.is(_.isObject(ownerObject.parameters), true, 'wallet has uphold parameters')
  t.is(ownerObject.authorized, true, 'owner is authorized')

  const { body } = await eyeshadeAgent
    .get(owner.urls.root)
    .expect(ok)
  const { wallet } = body
  t.true(_.isObject(wallet), 'wallet info is returned')

  const {
    authorized,
    isMember,
    id,
    availableCurrencies,
    possibleCurrencies,
    scope
  } = wallet

  t.is(authorized, true, 'sanity')
  t.is(isMember, true, 'sanity')
  t.true(_.isString(id), 'an id is returned on the wallet object')
  t.is(Array.isArray(availableCurrencies), true, 'get wallet returns currencies we have a card for')
  // since we're reusing the test ledger wallet, this should always be true
  t.is(availableCurrencies.indexOf('BAT') !== -1, true, 'wallet has a BAT card')
  // hopefully no one creates a JPY card on the test ledger wallet :)
  t.is(availableCurrencies.indexOf('JPY'), -1, 'wallet does not have a JPY card')

  t.is(Array.isArray(possibleCurrencies), true, 'get wallet returns currencies we could create a card for')
  t.is(possibleCurrencies.indexOf('BAT') !== -1, true, 'wallet can have a BAT card')
  t.is(possibleCurrencies.indexOf('JPY') !== -1, true, 'wallet can have a JPY card')
  t.is(scope, SCOPE, 'get wallet returns authorization scope')
  await owners.removeByOwner(runtime, owner.key)
})

test('eyeshade PUT /v1/owners/{owner}/wallet with uphold parameters', async t => {
  t.plan(14)

  const OWNER = publisherId()
  const SCOPE = 'cards:read user:read'
  const encodedOwner = encodeURIComponent(OWNER)
  const ownerWalletUrl = `/v1/owners/${encodedOwner}/wallet`

  t.is(await owners.countByOwner(runtime, OWNER), '0', 'sanity')

  const dataOwnerWalletParams = {
    provider: 'uphold',
    parameters: {
      access_token: process.env.UPHOLD_ACCESS_TOKEN,
      scope: SCOPE
    }
  }
  await eyeshadeAgent.put(ownerWalletUrl)
    .send(dataOwnerWalletParams)
    .expect(200)

  t.is(await owners.countByOwner(runtime, OWNER), '1', 'can add owner')

  let owner = await owners.readByOwner(runtime, OWNER)
  t.is(_.isObject(owner.parameters), true, 'wallet has uphold parameters')
  t.is(owner.authorized, true, 'owner is authorized')

  const { body } = await eyeshadeAgent.get(ownerWalletUrl)
    .send().expect(200)
  const { wallet } = body
  const {
    authorized,
    isMember,
    id,
    availableCurrencies,
    possibleCurrencies,
    scope
  } = wallet

  t.is(authorized, true, 'sanity')
  t.is(isMember, true, 'sanity')
  t.true(_.isString(id), 'an id is returned on the wallet object')
  t.is(Array.isArray(availableCurrencies), true, 'get wallet returns currencies we have a card for')
  // since we're reusing the test ledger wallet, this should always be true
  t.is(availableCurrencies.indexOf('BAT') !== -1, true, 'wallet has a BAT card')
  // hopefully no one creates a JPY card on the test ledger wallet :)
  t.is(availableCurrencies.indexOf('JPY'), -1, 'wallet does not have a JPY card')

  t.is(Array.isArray(possibleCurrencies), true, 'get wallet returns currencies we could create a card for')
  t.is(possibleCurrencies.indexOf('BAT') !== -1, true, 'wallet can have a BAT card')
  t.is(possibleCurrencies.indexOf('JPY') !== -1, true, 'wallet can have a JPY card')
  t.is(scope, SCOPE, 'get wallet returns authorization scope')
  await owners.removeByOwner(runtime, OWNER)
})

test('eyeshade: create brave youtube channel and owner, verify with uphold, add BAT card', async t => {
  const encodedOwner = encodeURIComponent(braveYoutubeOwner)

  const walletUrl = `/v1/owners/${encodedOwner}/wallet`
  const parameters = {
    access_token: process.env.UPHOLD_ACCESS_TOKEN,
    show_verification_status: false
  }
  const data = {
    provider: 'uphold',
    defaultCurrency: 'DASH',
    parameters
  }
  await eyeshadeAgent.put(walletUrl).send(data).expect(ok)

  await createCard(braveYoutubeOwner, 'BAT')
  const { body: wallet1 } = await eyeshadeAgent.get(walletUrl)
    .send().expect(200)
  checkRates(wallet1)

  await createCard(braveYoutubeOwner, 'XAU')
  const { body: wallet2 } = await eyeshadeAgent.get(walletUrl)
    .send().expect(200)
  checkRates(wallet2)

  function checkRates (wallet) {
    const { rates } = wallet
    const keys = _.keys(rates)
    for (let ticker of keys) {
      t.true(_.isString(rates[ticker]), 'is a string')
    }
  }
})

test('eyeshade: missing owners send back proper status', async (t) => {
  t.plan(1)
  const id = uuidV4()
  const badOwner = `publishers#uuid:${id}`
  const badEncoding = encodeURIComponent(badOwner)
  const badURL = `/v1/owners/${badEncoding}/wallet`

  await eyeshadeAgent
    .get(badURL)
    .send()
    .expect(404)

  const SCOPE = 'cards:read user:read'
  const dataOwnerWalletParams = {
    provider: 'uphold',
    parameters: {
      access_token: process.env.UPHOLD_ACCESS_TOKEN + 'fake',
      scope: SCOPE
    }
  }
  await eyeshadeAgent.put(badURL)
    .send(dataOwnerWalletParams)
    .expect(200)

  const { body } = await eyeshadeAgent
    .get(badURL)
    .send()
    .expect(200)
  t.deepEqual(body.status, {
    provider: 'uphold',
    action: 're-authorize'
  }, 'let client know a reauthorize is needed / that the token is bad')
})

function createCard (owner, currency) {
  const encodedOwner = encodeURIComponent(owner)
  const createCardData = { currency }
  const cardUrl = `/v3/owners/${encodedOwner}/wallet/card`
  return eyeshadeAgent.post(cardUrl).send(createCardData).expect(ok)
}

function createOwnerInfos () {
  const key = publisherId()
  const encoded = encodeURIComponent(key)
  const root = `/v1/owners/${encoded}/wallet`
  const card = `/v3/owners/${encoded}/wallet/card`
  return {
    key,
    encoded,
    urls: {
      root,
      card
    }
  }
}
