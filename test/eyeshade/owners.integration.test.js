'use strict'

import { serial as test } from 'ava'
import _ from 'underscore'

import {
  eyeshadeAgent,
  connectToDb,
  cleanEyeshadeDb,
  braveYoutubeOwner,
  ok
} from '../utils'

import dotenv from 'dotenv'
dotenv.config()

const collections = ['owners', 'publishers', 'tokens']

test.before(async () => connectToDb('eyeshade'))
test.beforeEach(async (t) => {
  const db = await cleanEyeshadeDb(collections)
  collections.forEach((name) => {
    t.context[name] = db.collection(name)
  })
})

test('eyeshade PUT /v1/owners/{owner}/wallet with uphold parameters', async t => {
  t.plan(12)
  const { owners } = t.context
  const OWNER = 'publishers#uuid:8f3ae7ad-2842-53fd-8b63-c843afe1a33b'
  const SCOPE = 'cards:read user:read'

  const dbSelector = {
    owner: OWNER
  }
  const encodedOwner = encodeURIComponent(OWNER)
  const ownerWalletUrl = `/v1/owners/${encodedOwner}/wallet`

  t.is(await owners.count(dbSelector), 0, 'sanity')

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

  t.is(await owners.count(dbSelector), 1, 'can add owner')

  let owner = await owners.findOne(dbSelector)
  t.is(_.isObject(owner.parameters), true, 'wallet has uphold parameters')
  t.is(owner.authorized, true, 'owner is authorized')

  const { body } = await eyeshadeAgent.get(ownerWalletUrl)
    .send().expect(200)
  const { wallet } = body
  const {
    authorized,
    availableCurrencies,
    possibleCurrencies,
    scope
  } = wallet

  t.is(authorized, true, 'sanity')
  t.is(Array.isArray(availableCurrencies), true, 'get wallet returns currencies we have a card for')
  // since we're reusing the test ledger wallet, this should always be true
  t.is(availableCurrencies.indexOf('BAT') !== -1, true, 'wallet has a BAT card')
  // hopefully no one creates a JPY card on the test ledger wallet :)
  t.is(availableCurrencies.indexOf('JPY'), -1, 'wallet does not have a JPY card')

  t.is(Array.isArray(possibleCurrencies), true, 'get wallet returns currencies we could create a card for')
  t.is(possibleCurrencies.indexOf('BAT') !== -1, true, 'wallet can have a BAT card')
  t.is(possibleCurrencies.indexOf('JPY') !== -1, true, 'wallet can have a JPY card')
  t.is(scope, SCOPE, 'get wallet returns authorization scope')
})

test('eyeshade: create brave youtube channel and owner, verify with uphold, add BAT card', async t => {
  t.plan(0)
  const encodedOwner = encodeURIComponent(braveYoutubeOwner)

  const walletUrl = `/v1/owners/${encodedOwner}/wallet`
  const parameters = {
    access_token: process.env.UPHOLD_ACCESS_TOKEN,
    show_verification_status: false,
    defaultCurrency: 'USD'
  }
  const data = {
    provider: 'uphold',
    parameters
  }
  await eyeshadeAgent.put(walletUrl).send(data).expect(ok)

  const currency = 'BAT'
  const createCardData = { currency }
  const cardUrl = `/v3/owners/${encodedOwner}/wallet/card`
  await eyeshadeAgent.post(cardUrl).send(createCardData).expect(ok)
})
