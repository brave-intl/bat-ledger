'use strict'
const { serial: test } = require('ava')
const _ = require('underscore')
const uuidV4 = require('uuid/v4')
const {
  ok,
  cleanDbs,
  cleanPgDb,
  agents,
  readJSONFile,
  connectToDb,
  braveYoutubePublisher
} = require('../utils')
const {
  BigNumber,
  timeout
} = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')

const originalGroupId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
const sept = new Date('2019-09-30')
const oct1 = new Date('2019-10-01')
const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL
} = process.env
const runtime = new Runtime({
  prometheus: {
    label: 'eyeshade.worker.1'
  },
  cache: {
    redis: {
      url: BAT_REDIS_URL
    }
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
  const groupId1 = 'e48f310b-0e81-4b39-a836-4dda32d7df74'
  const groupId2 = '6491bbe5-4d50-4c05-af5c-a2ac4a04d14e'
  const australiaInGroup1 = `
  INSERT INTO geo_referral_countries
    (group_id,name,country_code)
  VALUES
    ('${groupId1}','Australia','AU')
  `
  await t.context.postgres.query(australiaInGroup1)
  const unresolvedGroups = await getGroups({ fields })
  const howUnresolvedGroupsShouldLookBase = normalizeGroups(json)
  howUnresolvedGroupsShouldLookBase.find(({ id }) => id === groupId1).codes.push('AU')
  const howUnresolvedGroupsShouldLook = normalizeGroups(howUnresolvedGroupsShouldLookBase)
  t.deepEqual(normalizeGroups(unresolvedGroups), howUnresolvedGroupsShouldLook, 'should add au to the group')

  const howResolvedGroupsShouldLook = normalizeGroups(howUnresolvedGroupsShouldLookBase)
  const resolvedGroup = howResolvedGroupsShouldLook.find(({ id }) => id === groupId2)
  const auIndex = resolvedGroup.codes.indexOf('AU')
  resolvedGroup.codes.splice(auIndex, auIndex + 1) // throw away
  const resolvedGroups = await getGroups({ fields, resolve: true })
  t.deepEqual(normalizeGroups(resolvedGroups), howResolvedGroupsShouldLook, 'should remove au from group 2')
})

async function getGroups (query = {}) {
  const {
    body
  } = await agents.eyeshade.referrals.get('/v1/referrals/groups')
    .query(query)
    .expect(ok)
  return normalizeGroups(body)
}

function normalizeGroups (_body) {
  const body = _body.slice(0).sort((a, b) => a.id > b.id ? 1 : -1)
  for (let i = 0; i < body.length; i += 1) {
    const group = body[i]
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
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral]).expect(200)

  // ensure referral docs are created in mongo
  const referralCollection = await eyeshadeMongo.collection('referrals')
  const referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  await ensureReferrals(runtime, 1)
})

test('peer to peer referrals are inserted into mongo then eventually postgres', async t => {
  const eyeshadeMongo = await connectToDb('eyeshade')

  const txId = uuidV4().toLowerCase()
  const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()
  const referral1 = {
    downloadId: uuidV4().toLowerCase(),
    // no channelId value
    channelId: null,
    platform: 'ios',
    finalized: new Date(),
    ownerId
  }
  const referral2 = {
    downloadId: uuidV4().toLowerCase(),
    // no channel id key
    platform: 'android',
    finalized: new Date(),
    ownerId
  }
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral1, referral2]).expect(200)

  // ensure referral docs are created in mongo
  const referralCollection = await eyeshadeMongo.collection('referrals')
  const referralDocs = await referralCollection.find({ transactionId: txId }).toArray()
  const mongoAmount = (new BigNumber(referralDocs[0].probi)).times(2).dividedBy(1e18).toFixed(18)
  t.is(referralDocs.length, 2)
  t.true(mongoAmount > 0, 'an amount is held for each referral')

  const rows = await ensureReferrals(runtime, 1)
  const row = rows[0]
  const postgresAmount = (new BigNumber(row.amount)).toFixed(18)
  t.is(1, rows.length, 'only one transaction is added')
  t.is(mongoAmount, postgresAmount, 'summed amounts match')
  t.is(null, row.channel, 'the channel id should not be set')
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
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral]).expect(200)

  // ensure referral docs are created in mongo
  const referralCollection = await eyeshadeMongo.collection('referrals')
  let referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  // post the same referral again and ensure no more were created
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral]).expect(200)
  referralDocs = await referralCollection.find({ downloadId: referral.downloadId }).toArray()
  t.true(referralDocs.length === 1)

  // post the same referral again under different txId but same downloadId and ensure no more were created
  const txId2 = uuidV4().toLowerCase()
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId2}`).send([referral]).expect(200)
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

  await agents.eyeshade.referrals.put(`/v1/referrals/${uuidV4().toLowerCase()}`).send([referral]).expect(200)

  const txId = uuidV4().toLowerCase()
  const referral2 = {
    downloadId: uuidV4().toLowerCase(),
    channelId: braveYoutubePublisher,
    platform: 'ios',
    finalized: new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }

  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral, referral2]).expect(200)
  const referralDocs = await t.context.referrals.find({ transactionId: txId }).toArray()
  t.is(referralDocs.length, 1)

  await ensureReferrals(runtime, 2)
})

test('referrals use the correct geo-specific amount and checked values', async t => {
  const tier2GroupId = '6491bbe5-4d50-4c05-af5c-a2ac4a04d14e'

  await setActiveAt(t.context.postgres, new Date(1))

  const {
    referral: referral0
  } = await sendReferral(sept, '')
  await checkReferralValue(t, sept, originalGroupId, '5', referral0)

  const {
    referral: referral1
  } = await sendReferral(sept, null)
  await checkReferralValue(t, sept, originalGroupId, '5', referral1)

  await t.throwsAsync(sendReferral(oct1, uuidV4().toLowerCase()), Error, 'invalid group id fails')

  const {
    referral: referral2
  } = await sendReferral(oct1, tier2GroupId)
  await checkReferralValue(t, oct1, tier2GroupId, '6.5', referral2)

  await ensureReferrals(runtime, 3)
})

test('unable to insert a row with the same country code and created_at twice', async (t) => {
  const { rows } = await runtime.postgres.query(`
  select *
  from geo_referral_countries
  where country_code = 'US'`)
  const us = rows[0]
  await t.throwsAsync(async () => {
    return runtime.postgres.query(`
  insert into
  geo_referral_countries(country_code, created_at, name, group_id)
  values($1, $2, 'anyname', $3)`, ['US', +us.created_at, us.group_id])
  })
})

async function setActiveAt (client, date) {
  const oct1 = new Date('2019-10-01')
  const min = date > oct1 ? oct1 : date
  await client.query(`
UPDATE geo_referral_groups
SET
  active_at = $2
WHERE
  id != $1;`, [originalGroupId, min])
}

async function checkReferralValue (t, startDate, expectedGroupId, expectedValue, {
  referralCode,
  downloadId,
  defaultPayoutRate
}) {
  const referral = await t.context.referrals.findOne({ downloadId })
  const {
    groupId,
    probi,
    owner,
    payoutRate = defaultPayoutRate
  } = referral
  t.is(referral.referralCode, referralCode, 'referral code matches')
  t.is(groupId, expectedGroupId, 'group id should persist on mongo collection but be ignored for referrals without group')
  const bat = (new BigNumber(probi.toString())).dividedBy(1e18)
  const dollars = bat.dividedBy(payoutRate).round(6).toString()
  t.is(expectedValue, dollars, 'a known number of dollars should exist')

  const escapedOwnerId = encodeURIComponent(owner)
  const start = startDate.toISOString()
  const {
    body
  } = await agents.eyeshade.referrals
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
    referralCode: uuidV4().toLowerCase(),
    finalized: timestamp || new Date(),
    groupId,
    downloadTimestamp: timestamp || new Date(),
    ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
  }
  await agents.eyeshade.referrals.put(`/v1/referrals/${txId}`).send([referral]).expect(ok)
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
    rows = (await postgresClient.query('select * from transactions where transaction_type = \'referral\';')).rows
    await timeout(500)
  } while (rows.length !== expect)
  postgresClient.release()
  return rows
}
