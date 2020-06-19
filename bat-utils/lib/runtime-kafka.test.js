'use strict'

const Kafka = require('./runtime-kafka')
const test = require('ava')
const uuidV4 = require('uuid/v4')
const _ = require('underscore')
const { timeout } = require('./extras-utils')

process.env.KAFKA_CONSUMER_GROUP = 'test-consumer'
const Postgres = require('bat-utils/lib/runtime-postgres')
const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
const runtime = {
  config: require('../../config'),
  postgres,
  captureException: function () {
    console.log('captured', arguments)
  }
}

test('can create kafka consumer', async (t) => {
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  const consumer = new Kafka(runtime.config, runtime)
  const messagePromise = new Promise(resolve => {
    consumer.on('test-topic', async (messages) => {
      resolve(Buffer.from(messages[0].value, 'binary').toString())
    })
  })
  await consumer.consume()

  await producer.send('test-topic', 'hello world')

  const message = await messagePromise

  t.is(message, 'hello world')
})
test('one topic failing does not cause others to fail', async (t) => {
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()
  const topic1 = 'test-topic-1-' + uuidV4()
  const topic2 = 'test-topic-2-' + uuidV4()
  const state = {
    [topic1]: [],
    [topic2]: []
  }
  const consumer = new Kafka(runtime.config, runtime)
  consumer.on(topic1, pseudoDBTX(topic1))
  const errAt = 25
  const consumptionPattern = []
  consumer.on(topic2, async (messages) => {
    // simulate a topic handler working improperly
    const toAppend = []
    consumptionPattern.push(messages.length)
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      const msg = Buffer.from(message.value, 'binary').toString()
      toAppend.push(msg)
      if ((state[topic2].length + toAppend.length) > errAt) {
        throw new Error('erred')
      }
    }
    state[topic2] = state[topic2].concat(toAppend)
  })

  const consumers = await consumer.consume()
  const messages = []
  for (let i = 0; i < 10; i += 1) {
    messages.push(sendMsgs())
  }
  const expectingTopic1 = [].concat.apply([], await Promise.all(messages))
  await waitForParody(topic1)

  // check state
  t.true(state[topic1].length === 100, 'topic 1 should have processed 100 msgs')
  t.deepEqual(expectingTopic1, state[topic1], 'topic 1 state should be as expected')
  const expectedLength = consumptionPattern.reduce((memo, value) => {
    return (memo + value) > errAt ? memo : (memo + value)
  })
  console.log('consumption pattern', expectedLength, consumptionPattern)
  t.is(expectedLength, state[topic2].length, `topic 2 should be less than or equal to ${expectedLength} in length`)
  const expectedStateTopic2 = expectingTopic1.slice(0, state[topic2].length)
  t.deepEqual(expectedStateTopic2, state[topic2], 'topic2 should the frist ordered subset of topic 1')

  // service gets restarted
  consumers.forEach((consumer) => consumer.close())
  const consumer2 = new Kafka(runtime.config, runtime)
  consumer2.on(topic2, pseudoDBTX(topic2))
  await consumer2.consume()
  await waitForParody(topic2)

  async function waitForParody (topic) {
    do {
      await timeout(500)
    } while (!_.isEqual(state[topic], expectingTopic1))
  }

  function pseudoDBTX (topic) {
    return async (messages) => {
      // simulate a topic handler working properly
      const toAppend = []
      for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i]
        const msg = Buffer.from(message.value, 'binary').toString()
        toAppend.push(msg)
      }
      state[topic] = state[topic].concat(toAppend)
    }
  }

  async function sendMsgs () {
    const msgs = []
    let promises = []
    for (let i = 0; i < 10; i += 1) {
      const now = (new Date()).toISOString()
      msgs.push(now)
      promises = promises.concat([
        producer.send(topic1, now),
        producer.send(topic2, now)
      ])
    }
    await Promise.all(promises)
    return msgs
  }
})
