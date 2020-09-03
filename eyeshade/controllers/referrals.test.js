// 'use strict'
// const { serial: test } = require('ava')
// const _ = require('underscore')
// const uuidV4 = require('uuid/v4')
// const {
//   ok,
//   cleanDbs,
//   readJSONFile,
//   connectToDb,
//   setupForwardingServer,
//   braveYoutubePublisher,
//   token,
//   AUTH_KEY
// } = require('../../test/utils')
// const { kafka } = require('../../config')
// const {
//   BigNumber,
//   timeout
// } = require('bat-utils/lib/extras-utils')

// const {
//   routes: referralsRoutes,
//   initialize: referralsInitializer
// } = require('./referrals')

// const originalGroupId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
// const sept = new Date('2019-09-30')
// const oct1 = new Date('2019-10-01')

// test.before(async (t) => {
//   Object.assign(t.context, await setupForwardingServer({
//     token: null,
//     routes: [].concat(referralsRoutes),
//     initers: [referralsInitializer],
//     config: {
//       forward: {},
//       kafka,
//       postgres: {
//         url: process.env.BAT_POSTGRES_URL
//       }
//     }
//   }))
//   t.context.agent = t.context.agent.set(AUTH_KEY, token(process.env.ALLOWED_REFERRALS_TOKENS))
// })

// test.after(async (t) => {
//   await t.context.server.stop({ timeout: 0 })
//   // await t.context.runtime.quit()
// })
// test.beforeEach(cleanDbs)

// test('referral groups are returned correctly', async (t) => {
//   let body, fields
//   const requiredKeys = ['id']
//   const json = normalizeGroups(readJSONFile('data', 'referral-groups', '0010.json'))
//   body = await getGroups(t)
//   t.deepEqual(json.map(j => _.pick(j, ['id'])), body, 'no fields results in only ids')
//   // one field
//   fields = ['codes']
//   body = await getGroups(t, { fields })
//   const codesSubset = json.map((j) => _.pick(j, requiredKeys.concat(fields)))
//   t.deepEqual(codesSubset, body, 'referral groups should be present')

//   fields = ['codes', 'name', 'currency', 'activeAt']
//   body = await getGroups(t, { fields })
//   const codesNameSubset = json.map((j) => _.pick(j, requiredKeys.concat(fields)))
//   t.deepEqual(codesNameSubset, body, 'referral fields should be present')
//   const stringQuery = await getGroups(t, { fields: 'codes,name,currency,activeAt' })
//   t.deepEqual(codesNameSubset, stringQuery, 'a string or array can be sent for query')
//   const whitespacedQuery = await getGroups(t, { fields: 'codes,name, currency, activeAt' })
//   t.deepEqual(codesNameSubset, whitespacedQuery, 'works with whitespace')
//   const groupId1 = 'e48f310b-0e81-4b39-a836-4dda32d7df74'
//   const groupId2 = '6491bbe5-4d50-4c05-af5c-a2ac4a04d14e'
//   const australiaInGroup1 = `
//   INSERT INTO geo_referral_countries
//     (group_id,name,country_code)
//   VALUES
//     ('${groupId1}','Australia','AU')
//   `
//   await t.context.runtime.postgres.query(australiaInGroup1)
//   const unresolvedGroups = await getGroups(t, { fields })
//   const howUnresolvedGroupsShouldLookBase = normalizeGroups(json)
//   howUnresolvedGroupsShouldLookBase.find(({ id }) => id === groupId1).codes.push('AU')
//   const howUnresolvedGroupsShouldLook = normalizeGroups(howUnresolvedGroupsShouldLookBase)
//   t.deepEqual(normalizeGroups(unresolvedGroups), howUnresolvedGroupsShouldLook, 'should add au to the group')

//   const howResolvedGroupsShouldLook = normalizeGroups(howUnresolvedGroupsShouldLookBase)
//   const resolvedGroup = howResolvedGroupsShouldLook.find(({ id }) => id === groupId2)
//   const auIndex = resolvedGroup.codes.indexOf('AU')
//   resolvedGroup.codes.splice(auIndex, auIndex + 1) // throw away
//   const resolvedGroups = await getGroups(t, { fields, resolve: true })
//   t.deepEqual(normalizeGroups(resolvedGroups), howResolvedGroupsShouldLook, 'should remove au from group 2')
// })

// async function getGroups (t, query = {}) {
//   const {
//     body
//   } = await t.context.agent.get('/v1/referrals/groups')
//     .query(query)
//     .expect(ok)
//   return normalizeGroups(body)
// }

// function normalizeGroups (_body) {
//   const body = _body.slice(0).sort((a, b) => a.id > b.id ? 1 : -1)
//   for (let i = 0; i < body.length; i += 1) {
//     const group = body[i]
//     const { codes } = group
//     if (codes) {
//       group.codes = codes.slice(0).sort()
//     }
//   }
//   return body
// }

// test('referrals are inserted into kafka queue and eventually postgres', async t => {
//   t.plan(0)
//   await sendReferrals(t, [
//     createReferral({
//       channelId: braveYoutubePublisher
//     })
//   ])
//   await ensureReferrals(t.context.runtime, 1)
// })

// test('peer to peer referrals are inserted into postgres', async t => {
//   const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()
//   const referral1 = {
//     // no channelId value
//     channelId: null,
//     platform: 'ios',
//     finalized: new Date(),
//     ownerId
//   }
//   const referral2 = {
//     // no channel id key
//     platform: 'android',
//     finalized: new Date(),
//     ownerId
//   }

//   await sendReferrals(t, [
//     createReferral(referral1),
//     createReferral(referral2)
//   ])

//   const rows = await ensureReferrals(t.context.runtime, 1)
//   t.is(1, rows.length, 'only one transaction is added')
//   t.is(null, rows[0].channel, 'the channel id should not be set')
// })

// test('referrals use the correct geo-specific amount and checked values', async t => {
//   const tier2GroupId = '6491bbe5-4d50-4c05-af5c-a2ac4a04d14e'

//   await setActiveAt(t.context.runtime.postgres, new Date(1))

//   const {
//     referrals: referrals0
//   } = await sendReferrals(t, [
//     createReferral({
//       channelId: braveYoutubePublisher,
//       finalized: sept,
//       downloadTimestamp: sept,
//       groupId: ''
//     })
//   ])
//   await checkReferralValue(t, sept, originalGroupId, '5', referrals0[0])

//   // const {
//   //   referrals: referrals1
//   // } = await sendReferral(t, sept, null)

//   const {
//     referrals: referrals1
//   } = await sendReferrals(t, [
//     createReferral({
//       channelId: braveYoutubePublisher,
//       finalized: oct1,
//       downloadTimestamp: oct1,
//       groupId: null
//     })
//   ])
//   await checkReferralValue(t, sept, originalGroupId, '5', referrals1[0])

//   await t.throwsAsync(sendReferrals(t, [
//     createReferral({
//       transactionId: uuidV4().toLowerCase()
//     })
//   ]), Error, 'invalid group id fails')

//   const {
//     referrals: referral2
//   } = await sendReferrals(t, [
//     createReferral({
//       channelId: braveYoutubePublisher,
//       finalized: oct1,
//       downloadTimestamp: oct1,
//       groupId: tier2GroupId
//     })
//   ])
//   await ensureReferrals(t.context.runtime, 3)
//   await checkReferralValue(t, oct1, tier2GroupId, '6.5', referral2)
// })

// test('unable to insert a row with the same country code and created_at twice', async (t) => {
//   const { rows } = await t.context.runtime.postgres.query(`
//   select *
//   from geo_referral_countries
//   where country_code = 'US'`)
//   const us = rows[0]
//   await t.throwsAsync(async () => {
//     return t.context.runtime.postgres.query(`
//   insert into
//   geo_referral_countries(country_code, created_at, name, group_id)
//   values($1, $2, 'anyname', $3)`, ['US', +us.created_at, us.group_id])
//   })
// })

// async function setActiveAt (client, date) {
//   const oct1 = new Date('2019-10-01')
//   const min = date > oct1 ? oct1 : date
//   await client.query(`
// UPDATE geo_referral_groups
// SET
//   active_at = $2
// WHERE
//   id != $1;`, [originalGroupId, min])
// }

// async function checkReferralValue (t, startDate, expectedGroupId, {
//   owner,
//   probi,
//   groupId
// }) {
//   t.is(groupId, expectedGroupId, 'group id should persist on mongo collection but be ignored for referrals without group')
//   const bat = (new BigNumber(probi.toString())).dividedBy(1e18)

//   const escapedOwnerId = encodeURIComponent(owner)
//   const start = startDate.toISOString()
//   const {
//     body
//   } = await t.context.agent
//     .get(`/v1/referrals/statement/${escapedOwnerId}`)
//     .query({ start })
//     .expect(ok)
//   t.is(body[0].amount, bat.toString(), 'bat matches that on collection')
// }

// function createReferral(ref) {
//   return Object.assign({
//     downloadId: uuidV4().toLowerCase(),
//     platform: 'ios',
//     referralCode: uuidV4().toLowerCase(),
//     finalized: new Date(),
//     downloadTimestamp: new Date(),
//     ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
//   }, ref)
// }

// async function sendReferral (t, timestamp, groupId) {
//   const txId = uuidV4().toLowerCase()
//   const referral = {
//     downloadId: uuidV4().toLowerCase(),
//     channelId: braveYoutubePublisher,
//     platform: 'ios',
//     referralCode: uuidV4().toLowerCase(),
//     finalized: timestamp || new Date(),
//     groupId,
//     downloadTimestamp: timestamp || new Date(),
//     ownerId: 'publishers#uuid:' + uuidV4().toLowerCase()
//   }
//   await t.context.agent.put(`/v1/referrals/${txId}`).send([referral]).expect(ok)
//   return {
//     referral,
//     txId
//   }
// }

// async function sendReferrals(t, referrals, _txId) {
//   const txId = _txId || uuidV4().toLowerCase()
//   console.log(txId, referrals)
//   const {
//     body
//   } = await t.context.agent.put(`/v1/referrals/${txId}`).send(referrals).expect(ok)
//   return {
//     referrals: body,
//     txId
//   }
// }

// async function ensureReferrals (runtime, expect) {
//   const postgresClient = await runtime.postgres.connect()
//   // ensure referral records are created in postgres
//   let rows
//   do { // wait until referral-report is processed and transactions are entered into postgres
//     rows = (await postgresClient.query('select * from transactions where transaction_type = \'referral\';')).rows
//     await timeout(500)
//   } while (rows.length !== expect)
//   postgresClient.release()
//   return rows
// }
