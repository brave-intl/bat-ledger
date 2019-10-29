'use strict'

import Kafka from './runtime-kafka'
import test from 'ava'

test('can create kafka consumer', async (t) => {
  const runtime = {
    config: { kafka: {} }
  }
  const producer = new Kafka(runtime.config)
  await producer.connect()

  const consumer = new Kafka(runtime.config)
  const messagesPromise = new Promise(resolve => {
    consumer.on('test-topic', async (messages) => {
      resolve(messages)
    })
  })
  await consumer.consume()

  await producer.send('test-topic', 'hello world')

  const messages = await messagesPromise

  t.is(messages.length, 1)
  t.is(messages[0].value, 'hello world')
})
