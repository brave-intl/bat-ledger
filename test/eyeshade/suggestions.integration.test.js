'use strict'

import Kafka from 'bat-utils/lib/runtime-kafka'
import test from 'ava'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import {
  eyeshadeAgent,
  cleanPgDb,
  ok
} from '../utils'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { suggestionType } from '../../eyeshade/lib/suggestions'

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
test.afterEach.always(async t => {
  await cleanPgDb(postgres)()
})

const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const example = {
  'id': 'e2874d25-14a9-4859-9729-78459af02a6f',
  'type': 'oneoff-tip',
  'channel': channel,
  'createdAt': (new Date()).toISOString(),
  'totalAmount': '10',
  'funding': [
    {
      'type': 'ugp',
      'amount': '10',
      'cohort': 'control',
      'promotion': '6820f6a4-c6ef-481d-879c-d2c30c8928c3'
    }
  ]
}
const balanceURL = '/v1/accounts/balances'

test('suggestions kafka consumer enters into votes', async (t) => {
  process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  const runtime = {
    config: require('../../config')
  }
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  let { body } = await eyeshadeAgent.get(balanceURL)
    .query({
      pending: true,
      account: channel
    })
  t.is(body.length, 0)

  await producer.send(process.env.ENV + '.grant.suggestion', suggestionType.toBuffer(example))

  while (!body.length) {
    await timeout(2000)
    ;({
      body
    } = await eyeshadeAgent.get(balanceURL)
      .query({
        pending: true,
        account: channel
      })
      .expect(ok))
  }
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '10.000000000000000000'
  }], 'suggestion votes show up after small delay')
})
