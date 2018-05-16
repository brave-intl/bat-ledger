'use strict'

import test from 'ava'
import _ from 'underscore'

import {
  eyeshadeAgent,
  connectEyeshadeDb,
  cleanEyeshadeDb
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

  const PATH = '/v2/owners'
  const dataPublisherWithYouTube = {
    'ownerId': 'publishers#uuid:8eb1efca-a648-5e37-b328-b298f232d70f',
    'contactInfo': {
      'name': 'Alice the Youtuber',
      'phone': '+14159001420',
      'email': 'alice2@spud.com'
    },
    'channels': [{
      'channelId': 'youtube#channel:323541525412313421'
    }]
  }
  const dbSelector = {
    'publisher': dataPublisherWithYouTube['channels'][0]['channelId']
  }

  t.is(await t.context.publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithYouTube)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'can add channels')
  const channel = await t.context.publishers.findOne(dbSelector)
  t.is(channel['providerName'], 'youtube', 'sets channel provider to youtube')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithYouTube)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'does not double add the same channel')
})

test('eyeshade POST /v2/owners with Twitch channels', async t => {
  t.plan(4)

  const PATH = '/v2/owners'
  const dataPublisherWithTwitch = {
    'ownerId': 'publishers#uuid:20995cae-d0f7-50b9-aa42-05ea04ab28be',
    'contactInfo': {
      'name': 'Alice the Twitcher',
      'phone': '+14159001420',
      'email': 'aliceTwitch@spud.com'
    },
    'channels': [{
      'channelId': 'twitch#channel:twtwtw',
      'authorizerName': 'TwTwTw'
    }]
  }
  const dbSelector = {
    'publisher': dataPublisherWithTwitch['channels'][0]['channelId']
  }

  t.is(await t.context.publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithTwitch)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'can add channels')
  const channel = await t.context.publishers.findOne(dbSelector)
  t.is(channel['providerName'], 'twitch', 'sets channel provider to twitch')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithTwitch)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'does not double add the same channel')
})

test('eyeshade POST /v2/owners with site channels', async t => {
  t.plan(4)

  const PATH = '/v2/owners'
  const dataPublisherWithSite = {
    'ownerId': 'publishers#uuid:8f3ae7ad-2842-53fd-8b63-c843afe1a33a',
    'contactInfo': {
      'name': 'Alice the Verified',
      'phone': '+14159001421',
      'email': 'alice@verified.org'
    },
    'channels': [{
      'channelId': 'verified.org'
    }]
  }
  const dbSelector = {
    'publisher': dataPublisherWithSite['channels'][0]['channelId']
  }

  t.is(await t.context.publishers.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithSite)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'can add channels')
  const channel = await t.context.publishers.findOne(dbSelector)
  t.is(channel['verified'], true, 'adds site channels in verified state')

  await eyeshadeAgent.post(PATH)
    .send(dataPublisherWithSite)
    .expect(200)
  t.is(await t.context.publishers.count(dbSelector), 1, 'does not double add the same channel')
})

test('eyeshade PUT /v1/owners/{owner}/wallet with uphold parameters', async t => {
  t.plan(6)

  const OWNER = 'publishers#uuid:8f3ae7ad-2842-53fd-8b63-c843afe1a33a'
  const dataPublisherWithSite = {
    'ownerId': OWNER,
    'contactInfo': {
      'name': 'Alice the Verified',
      'phone': '+14159001421',
      'email': 'alice@verified.org'
    },
    'channels': [{
      'channelId': 'verified.org'
    }]
  }
  const dbSelector = { 'owner': OWNER }

  t.is(await t.context.owners.count(dbSelector), 0, 'sanity')
  await eyeshadeAgent.post('/v2/owners')
    .send(dataPublisherWithSite)
    .expect(200)
  t.is(await t.context.owners.count(dbSelector), 1, 'can add owner')
  let owner = await t.context.owners.findOne(dbSelector)
  t.is(owner['parameters'], undefined, 'sanity')
  t.is(owner['authorized'], undefined, 'sanity')

  const dataOwnerWalletParams = {
    'provider': 'uphold',
    'parameters': {
    }
  }
  await eyeshadeAgent.put(`/v1/owners/${encodeURIComponent(OWNER)}/wallet`)
    .send(dataOwnerWalletParams)
    .expect(200)

  owner = await t.context.owners.findOne(dbSelector)
  t.is(_.isObject(owner['parameters']), true, 'wallet has uphold parameters')
  t.is(owner['authorized'], true, 'owner is authorized')
})
