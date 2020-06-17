'use strict'

const Kafka = require('bat-utils/lib/runtime-kafka')
const test = require('ava')
const fs = require('fs')
const path = require('path')
const {
  timeout
} = require('bat-utils/lib/extras-utils')
const {
  agents,
  cleanPgDb,
  ok
} = require('../utils')
const Postgres = require('bat-utils/lib/runtime-postgres')
const { voteType } = require('../../eyeshade/lib/vote')
const { votesId } = require('../../eyeshade/lib/queries.js')
const moment = require('moment')

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
test.afterEach.always(cleanPgDb(postgres))

const date = moment().format('YYYY-MM-DD')
const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const example = {
  id: 'e2874d25-14a9-4859-9729-78459af02a6f',
  type: 'a_vote',
  channel: channel,
  createdAt: (new Date()).toISOString(),
  baseVoteValue: '0.25',
  voteTally: 10,
  fundingSource: 'uphold'
}
const balanceURL = '/v1/accounts/balances'

test('votes kafka consumer enters into votes', async (t) => {
  const producer = await createProducer()
  let { body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: channel
    }).expect(ok)
  t.is(body.length, 0)

  await sendVotes(producer, example)
  await sendVotes(producer, example)

  while (!body.length) {
    await timeout(2000)
    ;({
      body
    } = await agents.eyeshade.publishers.get(balanceURL)
      .query({
        pending: true,
        account: channel
      })
      .expect(ok))
  }

  const surveyorId = date + '_' + example.fundingSource
  const cohort = 'control'
  const publisher = example.channel

  // test the voteId is correct:
  const { rows } = await postgres.query(
    'select id, tally from votes where id=$1 limit 1',
    [votesId(publisher, cohort, surveyorId)])
  const result = rows[0]
  // assert the id is correct
  t.is(result.id, votesId(publisher, cohort, surveyorId))
  t.is(result.tally, 20)

  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '5.000000000000000000'
  }], 'vote votes show up after small delay')
})

test('votes go through', async (t) => {
  const jsonPath = path.join(__dirname, '..', 'data/votes/failed.json')
  const json = JSON.parse(fs.readFileSync(jsonPath))
  const producer = await createProducer()
  let msg
  // let afterVoteTally
  // let beforeVoteTally
  let i = 0
  // setInterval(() => {
  //   console.log({
  //     // i,
  //     // msg,
  //     // afterVoteTally,
  //     // beforeVoteTally
  //   })
  // }, 10000)
  json.sort((a, b) => a.createdAt > b.createdAt ? 1 : -1)
  for (; i < json.length; i += 1) {
    msg = json[i]
    await checkVoteTally(msg.channel)
    sendVotes(producer, msg)
  }
  // do {
  //   // await timeout(5000)
  //   // afterVoteTally = await checkVoteTally(msg.channel)
  // } while (true)
})

async function checkVoteTally (channel) {
  const { rows } = await postgres.query(`
  select coalesce(sum(tally), 0.0) as tally, channel
  from votes
  where channel = $1
  group by channel
  `, [channel])
  const row = rows[0]
  return row ? +row.tally : 0
}

async function sendVotes (producer, message) {
  await producer.send(process.env.ENV + '.payment.vote', voteType.toBuffer(message))
}

async function createProducer () {
  process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  const runtime = {
    config: require('../../config')
  }
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()
  return producer
}
