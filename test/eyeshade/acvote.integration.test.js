'use strict'

import Kafka from 'bat-utils/lib/runtime-kafka'
import test from 'ava'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import {
  agents,
  cleanPgDb,
  ok
} from '../utils'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { voteType } from '../../eyeshade/lib/vote'
const { votesId } = require('../../eyeshade/lib/queries.js')
const moment = require('moment')

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
test.afterEach.always(async t => {
  await cleanPgDb(postgres)()
})

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
  process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  const runtime = {
    config: require('../../config')
  }
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  let { body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: channel
    }).expect(ok)
  t.is(body.length, 0)

  await producer.send(process.env.ENV + '.payment.vote', voteType.toBuffer(example))
  await producer.send(process.env.ENV + '.payment.vote', voteType.toBuffer(example))

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
  const result = await postgres.query(
    'select id, tally from votes where id=$1 limit 1',
    votesId(publisher, cohort, surveyorId))
  // assert the id is correct
  t.is(result.id, votesId(publisher, cohort, surveyorId))
  t.is(result.tally, 20)

  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '20.000000000000000000'
  }], 'vote votes show up after small delay')
})
