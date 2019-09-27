'use strict'
import { serial as test } from 'ava'
import bson from 'bson'
import _ from 'underscore'
import uuidV4 from 'uuid/v4'
import BigNumber from 'bignumber.js'
import {
  ok,
  cleanDbs,
  cleanPgDb,
  eyeshadeAgent,
  readJSONFile,
  connectToDb,
  braveYoutubePublisher
} from '../utils'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import { Runtime } from 'bat-utils'

const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL
} = process.env
const runtime = new Runtime({
  prometheus: {
    label: 'eyeshade.worker.1',
    redis: BAT_REDIS_URL
  },
  postgres: {
    url: BAT_POSTGRES_URL
  }
})
test.beforeEach(async (t) => {
  const eyeshadeMongo = await connectToDb('eyeshade')
  const referralCollection = await eyeshadeMongo.collection('referrals')
  t.context.referrals = referralCollection
  t.context.postgres = await runtime.postgres.connect()
})
test.afterEach.always(cleanDbs)
test.afterEach.always(cleanPgDb(runtime.postgres))
test.afterEach.always((t) => t.context.postgres.release())

test('referral groups are returned correctly', async (t) => {
  let body, fields
  const requiredKeys = ['id']
  const json = normalizeGroups(readJSONFile('data', 'referral-groups', '0010.json'))
  body = await getGroups()
  t.deepEqual(json.map(j => _.pick(j, ['id'])), body, 'no fields results in only ids')
  // one field
  fields = ['codes']
  body = await getGroups({ fields })
  const codesSubset = json.map((j) => _.pick(j, requiredKeys.concat(fields)))
  t.deepEqual(codesSubset, body, 'referral groups should be present')

  fields = ['codes', 'name', 'currency', 'activeAt']
  body = await getGroups({ fields })
  const codesNameSubset = json.map((j) => _.pick(j, requiredKeys.concat(fields)))
  t.deepEqual(codesNameSubset, body, 'referral fields should be present')
  const stringQuery = await getGroups({ fields: 'codes,name,currency,activeAt' })
  t.deepEqual(codesNameSubset, stringQuery, 'a string or array can be sent for query')
  const whitespacedQuery = await getGroups({ fields: 'codes,name, currency, activeAt' })
  t.deepEqual(codesNameSubset, whitespacedQuery, 'works with whitespace')
})

async function getGroups (query = {}) {
  const {
    body
  } = await eyeshadeAgent.get('/v1/referrals/groups')
    .query(query)
    .expect(ok)
  return normalizeGroups(body)
}

function normalizeGroups (_body) {
  const body = _body.slice(0).sort((a, b) => a.id > b.id ? 1 : -1)
  for (const group of body) {
    const { codes } = group
    if (codes) {
      group.codes = codes.slice(0).sort()
    }
  }
  return body
}

test('referrals are inserted into mongo then eventually postgres', async t => {
  const eyeshadeMongo = await connectToDb('eyeshade')

  const txId = uuidV4().toLowerCase()
  const referral = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }
  await eyeshadeAgent.put(`/v1/referrals/${txId}`).send([referral]).expect(200)

  // ensure referral docs are created in mongo
  const referralCollection = await eyeshadeMongo.collection('referrals')
  const referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  await ensureReferrals(runtime, 1)
})

test('duplicate referrals will not be inserted into mongo', async t => {
  const eyeshadeMongo = await connectToDb('eyeshade')
  const txId = uuidV4().toLowerCase()
  const referral = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }
  await eyeshadeAgent.put(`/v1/referrals/${txId}`).send([referral]).expect(200)

  // ensure referral docs are created in mongo
  const referralCollection = await eyeshadeMongo.collection('referrals')
  let referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  // post the same referral again and ensure no more were created
  await eyeshadeAgent.put(`/v1/referrals/${txId}`).send([referral]).expect(200)
  referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  // post the same referral again under different txId but same downloadId and ensure no more were created
  const txId2 = uuidV4().toLowerCase()
  await eyeshadeAgent.put(`/v1/referrals/${txId2}`).send([referral]).expect(200)
  referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()

  t.true(referralDocs.length === 1)
  t.true(referralDocs[0].transactionId === txId)
  await ensureReferrals(runtime, 1)
})

test('if promo sends mix of duplicate and valid referrals with same download id, only insert the valid referrals', async t => {
  const referral = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }

  await eyeshadeAgent.put(`/v1/referrals/${uuidV4().toLowerCase()}`).send([referral]).expect(200)

  const txId = uuidV4().toLowerCase()
  const referral2 = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }

  await eyeshadeAgent.put(`/v1/referrals/${txId}`).send([referral, referral2]).expect(200)
  const referralDocs = await t.context.referrals.find({ transactionId: txId }).toArray()
  t.is(referralDocs.length, 1)

  await ensureReferrals(runtime, 2)
})

test('referrals use the correct geo-specific amount and checked values', async t => {
  const tier2GroupId = '6491bbe5-4d50-4c05-af5c-a2ac4a04d14e'
  const minGroupDate = new Date('2019-10-01')
  const sept = new Date('2019-09-30')

  const {
    referral: referral0
  } = await sendReferral(sept, tier2GroupId)
  await checkReferralValue(t, sept, '', '5', referral0)

  const {
    referral: referral1
  } = await sendReferral(minGroupDate, uuidV4().toLowerCase())
  await checkReferralValue(t, minGroupDate, '', '5', referral1)

  const {
    referral: referral2
  } = await sendReferral(minGroupDate, tier2GroupId)
  await checkReferralValue(t, minGroupDate, tier2GroupId, '6.5', referral2)

  await ensureReferrals(runtime, 3)

  const bat = new BigNumber(30)
  const downloadId = uuidV4().toLowerCase()
  await t.context.referrals.insert({
    _id: bson.ObjectID.createFromTime(+sept / 1000),
    downloadId,
    finalized: sept,
    owner: 'publishers#uuid:' + uuidV4().toLowerCase(),
    publisher: braveYoutubePublisher,
    transactionId: uuidV4().toLowerCase(),
    exclude: false,
    platform: 'ios',
    altcurrency: 'BAT',
    probi: bson.Decimal128.fromString(bat.times(1e18).toString())
  })
  await checkReferralValue(t, sept, undefined, '5', {
    downloadId,
    defaultPayoutRate: '6',
    defaultGroupRate: '1'
  })
})

async function checkReferralValue (t, startDate, expectedGroupId, expectedValue, {
  downloadId,
  defaultPayoutRate,
  defaultGroupRate
}) {
  const referral = await t.context.referrals.findOne({ downloadId })
  const {
    groupId,
    probi,
    owner,
    payoutRate = defaultPayoutRate,
    groupRate = defaultGroupRate
  } = referral
  t.is(expectedGroupId, groupId, 'group id should persist on mongo collection but be ignored for referrals without group')
  const bat = (new BigNumber(probi.toString())).dividedBy(1e18)
  const dollars = bat.dividedBy(payoutRate).round(6).toString()
  t.is(expectedValue, dollars, 'a known number of dollars should exist')
  // currently usd
  t.is('1', groupRate, 'group rate is from the original group')

  const escapedOwnerId = encodeURIComponent(owner)
  const start = startDate.toISOString()
  const {
    body
  } = await eyeshadeAgent
    .get(`/v1/referrals/statement/${escapedOwnerId}`)
    .query({ start })
    .expect(ok)
  t.is(body[0].amount, bat.toString(), 'bat matches that on collection')
}

async function sendReferral (timestamp, groupId) {
  const txId = uuidV4().toLowerCase()
  const referral = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: timestamp || new Date(),
    // should attribute 6.5 bat / referral
    groupId,
    downloadTimestamp: timestamp || new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }
  await eyeshadeAgent.put(`/v1/referrals/${txId}`).send([referral]).expect(ok)
  return {
    referral,
    txId
  }
}

async function ensureReferrals (runtime, expect) {
  const postgresClient = await runtime.postgres.connect()
  // ensure referral records are created in postgres
  let rows
  do { // wait until referral-report is processed and transactions are entered into postgres
    rows = (await postgresClient.query(`select * from transactions where transaction_type = 'referral';`)).rows
    await timeout(500)
  } while (rows.length !== expect)
  postgresClient.release()
  return rows
}
