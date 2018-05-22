'use strict'

import test from 'ava'
import _ from 'underscore'

import {
  eyeshadeAgent,
  connectEyeshadeDb,
  cleanEyeshadeDb,
  braveYoutubeOwner,
  braveYoutubePublisher,
  ok
} from '../utils'

import dotenv from 'dotenv'
dotenv.config()

test.before(async t => {
  await connectEyeshadeDb(t)
})
test.beforeEach(async t => {
  await cleanEyeshadeDb(t)
})

test('eyeshade POST /v2/owners with YouTube channels', async t => {
  t.plan(4)
  const { publishers } = t.context
  const PATH = '/v2/owners'
  const channelId = 'youtube#channel:323541525412313421'
  const dataPublisherWithYouTube = {
    ownerId: 'publishers#uuid:8eb1efca-a648-5e37-b328-b298f232d70f',
    contactInfo: {
      name: 'Alice the Youtuber',
      phone: '+14159001420',
      email: 'alice2@spud.com'
    },
    channels: [{
      channelId
    }]
  }
  const dbSelector = {
    publisher: channelId
  }

  t.is(await publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithYouTube)
    .expect(200)
  t.is(await publishers.count(dbSelector), 1, 'can add channels')
  const channel = await publishers.findOne(dbSelector)
  t.is(channel.providerName, 'youtube', 'sets channel provider to youtube')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithYouTube)
    .expect(200)
  const publishersCount = await publishers.count(dbSelector)
  t.is(publishersCount, 1, 'does not double add the same channel')
})

test('eyeshade POST /v2/owners with Twitch channels', async t => {
  t.plan(4)
  const { publishers } = t.context
  const PATH = '/v2/owners'
  const channelId = 'twitch#channel:twtwtw'
  const dataPublisherWithTwitch = {
    ownerId: 'publishers#uuid:20995cae-d0f7-50b9-aa42-05ea04ab28be',
    contactInfo: {
      name: 'Alice the Twitcher',
      phone: '+14159001420',
      email: 'aliceTwitch@spud.com'
    },
    channels: [{
      channelId,
      authorizerName: 'TwTwTw'
    }]
  }
  const dbSelector = {
    publisher: channelId
  }

  t.is(await publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithTwitch)
    .expect(200)

  t.is(await publishers.count(dbSelector), 1, 'can add channels')
  const channel = await publishers.findOne(dbSelector)
  t.is(channel.providerName, 'twitch', 'sets channel provider to twitch')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithTwitch)
    .expect(200)

  t.is(await publishers.count(dbSelector), 1, 'does not double add the same channel')
})

test('eyeshade POST /v2/owners with site channels', async t => {
  t.plan(4)
  const { publishers } = t.context
  const PATH = '/v2/owners'
  const channelId = 'verified.org'
  const dataPublisherWithSite = {
    ownerId: 'publishers#uuid:8f3ae7ad-2842-53fd-8b63-c843afe1a33a',
    contactInfo: {
      name: 'Alice the Verified',
      phone: '+14159001421',
      email: 'alice@verified.org'
    },
    channels: [{
      channelId
    }]
  }
  const dbSelector = {
    publisher: channelId
  }

  t.is(await publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithSite)
    .expect(200)
  t.is(await publishers.count(dbSelector), 1, 'can add channels')
  const channel = await publishers.findOne(dbSelector)
  t.is(channel.verified, true, 'adds site channels in verified state')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithSite)
    .expect(200)

  t.is(await publishers.count(dbSelector), 1, 'does not double add the same channel')
})

test('eyeshade PUT /v1/owners/{owner}/wallet with uphold parameters', async t => {
  t.plan(15)
  const { owners } = t.context
  const OWNER = 'publishers#uuid:8f3ae7ad-2842-53fd-8b63-c843afe1a33a'
  const SCOPE = 'cards:read user:read'

  const dataPublisherWithSite = {
    ownerId: OWNER,
    contactInfo: {
      name: 'Alice the Verified',
      phone: '+14159001421',
      email: 'alice@verified.org'
    },
    channels: [{
      channelId: 'verified.org'
    }]
  }
  const dbSelector = {
    owner: OWNER
  }
  const encodedOwner = encodeURIComponent(OWNER)
  const ownerWalletUrl = `/v1/owners/${encodedOwner}/wallet`

  t.is(await owners.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post('/v2/owners')
    .send(dataPublisherWithSite)
    .expect(200)
  t.is(await owners.count(dbSelector), 1, 'can add owner')
  let owner = await owners.findOne(dbSelector)
  t.is(owner.parameters, undefined, 'sanity')
  t.is(owner.authorized, false, 'sanity')

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

  owner = await owners.findOne(dbSelector)
  t.is(_.isObject(owner.parameters), true, 'wallet has uphold parameters')
  t.is(owner.authorized, true, 'owner is authorized')

  // resend channel info
  await eyeshadeAgent.post('/v2/owners')
    .send(dataPublisherWithSite)
    .expect(200)

  owner = await owners.findOne(dbSelector)
  t.is(_.isObject(owner.parameters), true, 'wallet still has uphold parameters')
  t.is(owner.authorized, true, 'owner is still authorized')

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

  await eyeshadeAgent.post('/v2/owners').send({
    ownerId: braveYoutubeOwner,
    contactInfo: {
      name: 'Brave',
      phone: '+12345678900',
      email: 'null@brave.com'
    },
    channels: [{
      channelId: braveYoutubePublisher
    }]
  }).expect(ok)

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
