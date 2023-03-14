'use strict'

import Kafka from 'bat-utils/lib/runtime-kafka.js'
import { Runtime } from 'bat-utils/boot-runtime.js'
import test from 'ava'
import { v4 as uuidV4 } from 'uuid'
import { timeout } from 'bat-utils/lib/extras-utils.js'
import util from '../utils.js'
import Postgres from 'bat-utils/lib/runtime-postgres.js'
import suggestions from '../../eyeshade/lib/suggestions.js'
import suggestionsConsumer from '../../eyeshade/workers/suggestions.js'
import config from '../../config.js'

const postgres = new Postgres({ postgres: { connectionString: process.env.BAT_POSTGRES_URL } })
test.beforeEach(util.cleanEyeshadePgDb.bind(null, postgres))
test.afterEach.always(util.cleanEyeshadePgDb.bind(null, postgres))

const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const balanceURL = '/v1/accounts/balances'

test('suggestions kafka consumer enters into votes', async (t) => {
  // process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  let body
  const runtime = new Runtime(Object.assign({}, config, {
    testingCohorts: process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : [],
    postgres: {
      connectionString: process.env.BAT_POSTGRES_URL
    }
  }))
  suggestionsConsumer(runtime)
  await runtime.kafka.consume().catch(console.error)

  const producer = await new Kafka(runtime.config, runtime).producer()
  const example = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '10',
    funding: [
      {
        type: 'ugp',
        amount: '10',
        cohort: 'control',
        promotion: '6820f6a4-c6ef-481d-879c-d2c30c8928c3'
      }
    ]
  };

  ({
    body
  } = await util.agents.eyeshade.publishers.post(balanceURL)
    .send({
      pending: true,
      account: channel
    }).expect(util.ok))

  t.is(body.length, 0)

  await producer.send({ topic: process.env.ENV + '.grant.suggestion', messages: [{ value: suggestions.typeV1.toBuffer(example) }] })

  while (!body.length) {
    await timeout(5000);
    ({
      body
    } = await util.agents.eyeshade.publishers.post(balanceURL)
      .send({
        pending: true,
        account: channel
      })
      .expect(util.ok))
  }

  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '10.000000000000000000'
  }], 'suggestion votes show up after small delay')

  const exampleWithOrderId = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '10',
    orderId: uuidV4(),
    funding: [
      {
        type: 'ugp',
        amount: '10',
        cohort: 'control',
        promotion: '6820f6a4-c6ef-481d-879c-d2c30c8928c3'
      }
    ]
  };

  ({ body } = await util.agents.eyeshade.publishers.post(balanceURL)
    .send({
      pending: true,
      account: channel
    }).expect(util.ok))
  t.is(body.length, 1)

  await producer.send({ topic: process.env.ENV + '.grant.suggestion', messages: [{ value: suggestions.typeV1.toBuffer(exampleWithOrderId) }] })

  body = [{}]
  while (+body[0].balance !== 20) {
    await timeout(2000)
    ; ({
      body
    } = await util.agents.eyeshade.publishers.post(balanceURL)
      .send({
        pending: true,
        account: channel
      })
      .expect(util.ok))
  }
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '20.000000000000000000'
  }], 'suggestion votes show up after small delay')

  const exampleWithoutOrderId = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '10',
    funding: [
      {
        type: 'ugp',
        amount: '10',
        cohort: 'control',
        promotion: '6820f6a4-c6ef-481d-879c-d2c30c8928c3'
      }
    ]
  }
    ; ({ body } = await util.agents.eyeshade.publishers.post(balanceURL)
    .send({
      pending: true,
      account: channel
    }).expect(util.ok))
  t.is(body.length, 1)

  await producer.send({ topic: process.env.ENV + '.grant.suggestion', messages: [{ value: suggestions.typeV1.toBuffer(exampleWithoutOrderId) }] })

  body = [{}]
  while (+body[0].balance !== 30) {
    await timeout(2000)
    ; ({
      body
    } = await util.agents.eyeshade.publishers.post(balanceURL)
      .send({
        pending: true,
        account: channel
      })
      .expect(util.ok))
  }
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '30.000000000000000000'
  }], 'suggestion votes show up after small delay')

  const examplePayoutError = {
    id: uuidV4(),
    type: 'errored-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '1000',
    funding: [
      {
        type: 'ugp',
        amount: '1000',
        cohort: 'control',
        promotion: '2022-1-208277a30-78fd-48a7-a41a-a64b094a2f40asdf'
      }
    ]
  }

  await producer.send({ topic: process.env.ENV + '.grant.suggestion', messages: [{ value: suggestions.typeV1.toBuffer(examplePayoutError) }] })

  while (+body[0].balance < 30.25) {
    await timeout(2000)
    ; ({
      body
    } = await util.agents.eyeshade.publishers.post(balanceURL)
      .send({
        pending: true,
        account: channel
      })
      .expect(util.ok))
  }
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '30.250000000000000000'
  }], 'suggestion votes show up after small delay')
})
