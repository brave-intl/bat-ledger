'use strict'
const { serial: test } = require('ava')
const _ = require('underscore')
const {
  normalizeChannel,
  timeout
} = require('bat-utils/lib/extras-utils')
const { Runtime } = require('bat-utils')
const config = require('../../config')
const transaction = require('../lib/transaction')
const referrals = require('../lib/referrals')
const utils = require('../../test/utils')
const { consumer: referralsConsumer } = require('./referrals')

const {
  ok,
  cleanEyeshadePgDb,
  agents,
  readJSONFile
} = utils

test.before(async (t) => {
  Object.assign(t.context, {
    runtime: new Runtime(config)
  })
  referralsConsumer(t.context.runtime)
  await t.context.runtime.kafka.consume().catch(console.error)
})
test.beforeEach((t) => cleanEyeshadePgDb(t.context.runtime.postgres))

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
  await t.context.runtime.postgres.query(australiaInGroup1)
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

test('unable to insert a row with the same country code and created_at twice', async (t) => {
  const { rows } = await t.context.runtime.postgres.query(`
  select *
  from geo_referral_countries
  where country_code = 'US'`)
  const us = rows[0]
  await t.throwsAsync(async () => {
    return t.context.runtime.postgres.query(`
  insert into
  geo_referral_countries(country_code, created_at, name, group_id)
  values($1, $2, 'anyname', $3)`, ['US', +us.created_at, us.group_id])
  }, { instanceOf: Error })
})

test('referrals should be insertable from the kafka queue', async (t) => {
  const msgs = 10
  for (let i = 0; i < msgs; i += 1) {
    const referral = utils.referral.create()
    const buf = referrals.encode(referral)
    await t.context.runtime.kafka.send(referrals.topic, buf)
  }
  await t.notThrowsAsync(
    utils.transaction.ensureCount(t, msgs)
  )
})

test('messages are deduplicated', async t => {
  const referralBase = JSON.stringify(utils.referral.create())
  const referral1 = JSON.parse(referralBase)

  const messages = []
  for (let i = 0; i < 5; i += 1) {
    messages.push([])
    for (let j = 0; j < 10; j += 1) {
      messages[i].push(referral1)
    }
  }
  // a signal that messages have been processed
  const endingReferral = utils.referral.create()
  messages.push([endingReferral])

  for (let i = 0; i < messages.length; i += 1) {
    // send in blocks
    await Promise.all(messages[i].map((msg) => (
      t.context.runtime.kafka.send(
        referrals.topic,
        referrals.encode(msg)
      )
    )))
    await timeout(0)
  }
  const normalizedChannel = normalizeChannel(endingReferral.channelId)
  const id = transaction.id.referral(endingReferral.transactionId, normalizedChannel)
  await t.notThrowsAsync(
    utils.transaction.ensureArrived(t, id)
  )
  // 1 for the first transaction seen
  // 1 for the ending transaction
  await t.notThrowsAsync(
    utils.transaction.ensureCount(t, 2)
  )
})
