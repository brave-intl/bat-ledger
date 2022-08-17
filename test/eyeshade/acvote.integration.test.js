'use strict'

const Kafka = require('bat-utils/lib/runtime-kafka')
const { Runtime } = require('bat-utils')
const config = require('../../config')
const test = require('ava')
const _ = require('underscore')
const fs = require('fs')
const path = require('path')
const {
  timeout
} = require('bat-utils/lib/extras-utils')
const {
  agents,
  cleanEyeshadePgDb,
  ok
} = require('../utils')
const Postgres = require('bat-utils/lib/runtime-postgres')
const { voteType } = require('../../eyeshade/lib/vote')
const { votesId } = require('../../eyeshade/lib/queries.js')
const moment = require('moment')

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
test.beforeEach(cleanEyeshadePgDb.bind(null, postgres))
test.afterEach.always(cleanEyeshadePgDb.bind(null, postgres))

const date = moment().format('YYYY-MM-DD')
const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const example = {
  id: 'e2874d25-14a9-4859-9729-78459af02a6f',
  type: 'a_vote',
  channel,
  createdAt: (new Date()).toISOString(),
  baseVoteValue: '0.25',
  voteTally: 10,
  fundingSource: 'uphold'
}
const balanceURL = '/v1/accounts/balances'

test('votes kafka consumer enters into votes', async (t) => {
  const producer = await createProducer()
  let { body } = await agents.eyeshade.publishers.post(balanceURL)
    .send({
      pending: true,
      account: channel
    }).expect(ok)
  t.is(body.length, 0)

  await sendVotes(producer, example)
  await sendVotes(producer, example)

  while (!body.length) {
    await timeout(2000)
    ; ({
      body
    } = await agents.eyeshade.publishers.post(balanceURL)
      .send({
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
  json.sort((a, b) => a.createdAt > b.createdAt ? 1 : -1)
  const voteInput = json.reduce((_memo, msg) => {
    const memo = countMessage(_memo, msg)
    sendVotes(producer, msg)
    return memo
  }, [])
  const sortedVoteInput = sort(voteInput)
  let sortedVoteCounts
  do {
    await timeout(500)
    const voteCounts = await getVoteCounts()
    sortedVoteCounts = sort(voteCounts)
  } while (!_.isEqual(sortedVoteInput, sortedVoteCounts))
  t.deepEqual(sortedVoteInput, sortedVoteCounts)
})

function sort (array) {
  return array.slice(0).sort((a, b) => {
    if (a.channel !== b.channel) {
      return a.channel > b.channel ? 1 : -1
    }
    return a.surveyorId > b.surveyorId ? 1 : -1
  })
}

async function getVoteCounts () {
  const { rows } = await postgres.query(`
  select
    surveyor_id as "surveyorId",
    channel,
    tally
  from votes
  `)
  return rows
}

function countMessage (memo, msg) {
  const date = moment().format('YYYY-MM-DD')
  const { fundingSource, voteTally, channel } = msg
  const surveyorId = `${date}_${fundingSource}`
  let tally
  if (!(tally = _.find(memo, { surveyorId, channel }))) {
    tally = {
      surveyorId,
      channel,
      tally: 0
    }
    memo.push(tally)
  }
  tally.tally += voteTally
  return memo
}

async function sendVotes (producer, message) {
  const admin = await producer.admin()

  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      { topic: process.env.ENV + '.payment.vote', numPartitions: 1, replicationFactor: 1 }
    ]
  })

  await producer.send(process.env.ENV + '.payment.vote', voteType.toBuffer(message))
}

async function createProducer () {
  process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  const runtime = new Runtime(config)
  const producer = new Kafka(config, runtime)
  await producer.connect()
  return producer
}
