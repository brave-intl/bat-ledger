'use strict'

const Kafka = require('./runtime-kafka')
const test = require('ava')
const uuidV4 = require('uuid/v4')
const _ = require('underscore')
const { timeout } = require('./extras-utils')
process.env.KAFKA_CONSUMER_GROUP = 'test-consumer'
const runtime = {
  config: require('../../config')
}

test('can create kafka consumer', async (t) => {
  const producer = new Kafka(runtime.config, runtime)
  await producer.connect()

  const consumer = new Kafka(runtime.config, runtime)
  const messagePromise = new Promise(resolve => {
    consumer.on('test-topic', async (messages) => {
      const buf = Buffer.from(messages[0].value, 'binary')
      resolve(buf.toString())
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
  consumer.on(topic1, async (messages) => {
    const toAppend = []
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      const msg = Buffer.from(message.value, 'binary').toString()
      toAppend.push(msg)
    }
    state[topic1] = state[topic1].concat(toAppend)
  })
  const errAt = 25
  const consumptionPattern = []
  let everErred = false
  consumer.on(topic2, async (messages) => {
    const toAppend = []
    consumptionPattern.push(messages.length)
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      const msg = Buffer.from(message.value, 'binary').toString()
      toAppend.push(msg)
      if (((state[topic2].length + toAppend.length) > errAt) || everErred) {
        everErred = true
        throw new Error('erred')
      }
    }
    state[topic2] = state[topic2].concat(toAppend)
  })
  await consumer.consume()
  let expectingTopic1 = []
  for (let i = 0; i < 10; i += 1) {
    const msgs = await sendMsgs()
    expectingTopic1 = expectingTopic1.concat(msgs)
    do {
      await timeout(500)
    } while (!_.isEqual(state[topic1], expectingTopic1))
  }
  t.true(state[topic1].length === 100, 'topic 1 should have processed 100 msgs')
  t.deepEqual(expectingTopic1, state[topic1], 'topic 1 state should be as expected')
  t.true(state[topic2].length <= 25, 'topic 2 should be less than or equal to 25 in length')
  t.true(state[topic2].length > 15, 'topic 2 should be greater than 15 in length')
  t.deepEqual(expectingTopic1.slice(0, state[topic2].length), state[topic2], 'topic2 should the frist ordered subset of topic 1 ')

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
