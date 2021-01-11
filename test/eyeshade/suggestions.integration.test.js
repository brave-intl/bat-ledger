'use strict'

const Kafka = require('bat-utils/lib/runtime-kafka')
const Runtime = require('bat-utils/boot-runtime')
const test = require('ava')
const { v4: uuidV4 } = require('uuid')
const {
  timeout
} = require('bat-utils/lib/extras-utils')
const {
  agents,
  cleanEyeshadePgDb,
  ok
} = require('../utils')
const Postgres = require('bat-utils/lib/runtime-postgres')
const suggestions = require('../../eyeshade/lib/suggestions')

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
test.beforeEach(cleanEyeshadePgDb.bind(null, postgres))
test.afterEach.always(cleanEyeshadePgDb.bind(null, postgres))

const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const balanceURL = '/v1/accounts/balances'

test('suggestions kafka consumer enters into votes', async (t) => {
  process.env.KAFKA_CONSUMER_GROUP = 'test-producer'
  let body
  const runtime = new Runtime(Object.assign({}, require('../../config'), {
    testingCohorts: process.env.TESTING_COHORTS ? process.env.TESTING_COHORTS.split(',') : [],
    postgres: {
      url: process.env.BAT_POSTGRES_URL
    }
  }))
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  const example = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel: channel,
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
  ;({ body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: channel
    }).expect(ok))
  t.is(body.length, 0)

  await producer.send(process.env.ENV + '.grant.suggestion', suggestions.typeV1.toBuffer(example))

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
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '10.000000000000000000'
  }], 'suggestion votes show up after small delay')

  const exampleWithOrderId = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel: channel,
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
  }
  ;({ body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: channel
    }).expect(ok))
  t.is(body.length, 1)

  await producer.send(process.env.ENV + '.grant.suggestion', suggestions.typeV2.toBuffer(exampleWithOrderId))

  body = [{}]
  while (+body[0].balance !== 20) {
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
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '20.000000000000000000'
  }], 'suggestion votes show up after small delay')

  const exampleWithoutOrderId = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel: channel,
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
  ;({ body } = await agents.eyeshade.publishers.get(balanceURL)
    .query({
      pending: true,
      account: channel
    }).expect(ok))
  t.is(body.length, 1)

  await producer.send(process.env.ENV + '.grant.suggestion', suggestions.typeV2.toBuffer(exampleWithoutOrderId))

  body = [{}]
  while (+body[0].balance !== 30) {
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
  t.deepEqual(body, [{
    account_id: channel,
    account_type: 'channel',
    balance: '30.000000000000000000'
  }], 'suggestion votes show up after small delay')
})
