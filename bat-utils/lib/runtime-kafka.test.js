'use strict'

import Kafka from '../../bat-utils/lib/runtime-kafka.js'
import { Runtime } from 'bat-utils'
import config from '../../config.js'
import test from 'ava'
import { v4 as uuidV4 } from 'uuid'
import _ from 'underscore'
import { timeout } from './extras-utils.js'

process.env.KAFKA_CONSUMER_GROUP = 'test-consumer'
const runtime = new Runtime(config)

test('can create kafka consumer', async (t) => {
  const producer = new Kafka(config, runtime)
  await producer.connect()

  const consumer = new Kafka(runtime.config, runtime)
  const messagePromise = new Promise(resolve => {
    consumer.on('test-topic', async (messages) => {
      await consumer.mapMessages({ topic: 'test-topic', decode: (_) => { return { message: 'hi!' } } }, messages, async (item, timestamp) => {
        t.true(timestamp instanceof Date && !isNaN(timestamp))
        return true
      })
      resolve(Buffer.from(messages[0].value, 'binary').toString())
    })
  })
  await consumer.consume()

  const admin = await producer.admin()
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      { topic: 'test-topic', numPartitions: 1, replicationFactor: 1 }
    ]
  })

  await producer.send('test-topic', 'hello world')

  const message = await messagePromise

  t.is(message, 'hello world')
})

test('one topic failing does not cause others to fail', async (t) => {
  const producer = await new Kafka(config, runtime).producer()

  const topic1 = 'test-topic-1-' + uuidV4()
  const topic2 = 'test-topic-2-' + uuidV4()
  const state = {
    [topic1]: [],
    [topic2]: []
  }

  const consumer = new Kafka(runtime.config, runtime)

  const admin = await consumer.admin()
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      { topic: topic1, numPartitions: 1, replicationFactor: 1 },
      { topic: topic2, numPartitions: 1, replicationFactor: 1 }
    ]
  })

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
        throw new Error('erred!!')
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
  await waitForParity(topic1)

  // check state
  t.true(state[topic1].length === 100, 'topic 1 should have processed 100 msgs')
  t.deepEqual(expectingTopic1, state[topic1], 'topic 1 state should be as expected')

  const expectedLength = consumptionPattern.reduce((memo, value) => {
    return (memo + value) > errAt ? memo : (memo + value)
  }, 0)

  t.is(expectedLength, state[topic2].length, `topic 2 should be less than or equal to ${expectedLength} in length`)
  const expectedStateTopic2 = expectingTopic1.slice(0, state[topic2].length)
  t.deepEqual(expectedStateTopic2, state[topic2], 'topic2 should the first ordered subset of topic 1')

  // // service gets restarted
  for (const consu of consumers) {
    await consu.disconnect()
  }

  const consumer2 = new Kafka(runtime.config, runtime)

  consumer2.on(topic2, pseudoDBTX(topic2))

  await consumer2.consume()

  await waitForParity(topic2)

  async function waitForParity (topic) {
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
        producer.send({ topic: topic1, messages: [{ value: now }] }),
        producer.send({ topic: topic2, messages: [{ value: now }] })
      ])
    }
    await Promise.all(promises)
    return msgs
  }
})
