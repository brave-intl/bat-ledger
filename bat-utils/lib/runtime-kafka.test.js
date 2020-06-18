'use strict'

const Kafka = require('./runtime-kafka')
const test = require('ava')

test('can create kafka consumer', async (t) => {
  process.env.KAFKA_CONSUMER_GROUP = 'test-consumer'

  const runtime = {
    config: require('../../config')
  }
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
