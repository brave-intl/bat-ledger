const { Kafka, logLevel } = require('kafkajs')
const underscore = require('underscore')
const fs = require('fs')
const SDebug = require('sdebug')
const debug = new SDebug('kafka')

const groupId = process.env.ENV + '.' + process.env.SERVICE

class KafkaWrapper {
  constructor (config, runtime) {
    const { kafka } = config
    if (!kafka) {
      return
    }
    this.runtime = runtime
    this.config = kafka
    this.topicHandlers = {}
    this.topicConsumers = {}
    const brokers = process.env.KAFKA_BROKERS.split(',').map((broker) => broker.trim())
    this.kafka = new Kafka({
      logLevel: logLevel.INFO,
      // logCreator: debug,
      brokers,
      clientId: process.env.ENV + '.' + process.env.SERVICE,
      ssl: {
        servername: 'localhost',
        rejectUnauthorized: false,
        ca: [fs.readFileSync(process.env.KAFKA_SSL_CERTIFICATE_LOCATION, 'utf-8')]
      }
    })
  }

  async connect () {
    const { kafka, connecting } = this
    if (connecting) {
      return connecting
    }
    const producer = kafka.producer() // eslint-disable-line
    this._producer = producer
    const conn = producer.connect()
    this.connecting = conn
    return conn
  }

  async producer () {
    await this.connect()
    return this._producer
  }

  async quit () {
    let producerClose
    try {
      producerClose = await this._producer && this._producer.close()
    } catch (e) {}
    return Promise.all(
      [
        producerClose
      ].concat(
        Object.keys(this.topicConsumers).reduce((memo, key) =>
          memo.concat(
            this.topicConsumers[key].map((consumer) =>
              consumer.close()
            )
          ), [])
      )
    )
  }

  addTopicConsumer (topic, consumer) {
    const { topicConsumers } = this
    let consumers = topicConsumers[topic]
    if (!consumers) {
      consumers = []
      topicConsumers[topic] = consumers
    }
    consumers.push(consumer)
  }

  async mapMessages ({ decode, topic }, messages, fn) {
    const results = []
    const msgs = messages.map((msg) => {
      const { value, timestamp } = msg
      const buf = Buffer.from(value, 'binary')
      try {
        const { message } = decode(buf)
        return {
          value: message,
          timestamp: new Date(timestamp)
        }
      } catch (e) {
        // If the event is not well formed, capture the error and continue
        this.runtime.captureException(e, { extra: { topic, message: msg } })
        throw e
      }
    })
    for (let i = 0; i < msgs.length; i += 1) {
      results.push(await fn(msgs[i].value, msgs[i].timestamp))
    }
    return results
  }

  async sendMany (input, messages, partition = null, key = null) {
    return this.send(input, messages, partition, key)
  }

  async send (input, value, partition = null, key = null) {
    // return producer.send("my-topic", "my-message", 0, "my-key", "my-partition-key")
    const defaultEncode = (a) => a
    let encode = defaultEncode
    let topic = input
    if (!underscore.isString(input)) {
      ;({ topic, encode } = input)
    }
    let messages = [value]
    if (underscore.isArray(value)) {
      // still raw string values
      messages = value
    }
    const producer = await this.producer()
    const sending = {
      topic,
      messages: messages.map((value) => ({
        value: Buffer.isBuffer(value) ? value : encode(value),
        partition,
        key
      }))
    }
    console.log(sending)
    return producer.send(sending).then(() => debug('messages', messages))
  }

  on (input, handler) {
    const defaultDecode = (a) => a
    let decode = defaultDecode
    let topic = input
    if (!underscore.isString(topic)) {
      ;({ topic, decode = defaultDecode } = topic)
    }
    this.topicHandlers[topic] = {
      handler,
      decode
    }
  }

  async consume () {
    const { runtime, kafka } = this
    const topics = Object.keys(this.topicHandlers)
    const topicConfigs = topics.map((topic) => ({
      topic,
      replicationFactor: 3
    }))
    const admin = this.kafka.admin()
    await admin.createTopics({
      topics: topicConfigs
    })
    return Promise.all(topics.map(async (topic) => {
      const { decode, handler } = this.topicHandlers[topic]
      const consumer = kafka.consumer({ // eslint-disable-line
        groupId,
        heartbeatInterval: 1e4 // 10 seconds
      })
      await consumer.connect()
      await consumer.subscribe({ topic })
      this.addTopicConsumer(topic, consumer)
      await consumer.run({
        eachBatchAutoResolve: true,
        autoCommit: false,
        eachBatch: async ({
          // commitOffsetsIfNecessary,
          // uncommittedOffsets,
          // isRunning,
          // isStale,
          batch,
          resolveOffset,
          heartbeat
        }) => {
          await runtime.postgres.transact(async (client) => {
            kafka.logger().info('batch', batch)
            const {
              messages,
              topic,
              partition,
              highWatermark
            } = batch
            const msgs = messages.map(({
              offset,
              key,
              value,
              timestamp
            }) => ({
              offset,
              key,
              timestamp,
              value: decode(value),
              topic,
              partition,
              highWatermark
            }))
            await heartbeat()
            await handler(msgs, client, beat)

            async function beat (offset) {
              if (underscore.isNumber(offset)) {
                resolveOffset(offset)
              }
              return heartbeat()
            }
          })
        }
      })
      return consumer
    }))
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof KafkaWrapper)) return new KafkaWrapper(config, runtime)
}
