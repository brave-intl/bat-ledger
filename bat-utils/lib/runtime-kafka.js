const { Kafka } = require('kafkajs')

class RuntimeKafka {
  constructor (config, runtime) {
    const { kafka } = config
    if (!kafka) {
      return
    }

    this.runtime = runtime
    this.config = kafka
    this.topicHandlers = {}
    this.topicConsumers = {}
    this.kafka = new Kafka({ ...kafka })
  }

  async connect () {
    const producer = this.kafka.producer()
    this._producer = producer

    try {
      await producer.connect()
    } catch (error) {
      console.error(error)
      if (this.runtime.captureException) {
        this.runtime.captureException(error)
      }
    }
  }

  async producer () {
    if (!this._producer) {
      await this.connect()
      return this._producer
    }
    return this._producer
  }

  async quit () {
    let producerClose
    try {
      producerClose = await this._producer && this._producer.disconnect()
    } catch (e) {}
    return Promise.all(
      [
        producerClose
      ].concat(
        Object.keys(this.topicConsumers).reduce((memo, key) =>
          memo.concat(
            this.topicConsumers[key].map((consumer) =>
              consumer.disconnect()
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

  encodeMessages (encoder, messages) {
    const encoded = []
    for (let i = 0; i < messages.length; i += 1) {
      try {
        encoded.push(encoder(messages[i]))
      } catch (e) {
        this.runtime.captureException(e, {
          extra: {
            index: i,
            message: messages[i]
          }
        })
        throw e
      }
    }
    return encoded
  }

  async sendMany ({ topic, encode }, messages, _partition = null, _key = null) {
    // map twice to err quickly on input errors
    // use map during send to increase batching on network
    const encoded = this.encodeMessages(encode, messages)
    return Promise.all(
      encoded
        .map((msg) =>
          this.send(topic, msg, _partition, _key)
        )
    )
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
    // ...why are we double looping here?
    for (let i = 0; i < msgs.length; i += 1) {
      results.push(await fn(msgs[i].value, msgs[i].timestamp))
    }
    return results
  }

  async send (topicName, message, _partition = null, _key = null) {
    const producer = await this.producer()
    return producer.send({
      topic: topicName,
      messages: [{ key: _key, value: message, partition: _partition }],
      acks: this.config.acks
    })
  }

  on (topic, handler) {
    this.topicHandlers[topic] = handler
  }

  consume () {
    return Promise.all(Object.keys(this.topicHandlers).map(async (topic) => {
      const handler = this.topicHandlers[topic]
      const consumer = this.kafka.consumer({ groupId: `${this.config.clientId}-${topic}` })
      await consumer.connect()
      await consumer.subscribe({ topics: [topic] })
      this.addTopicConsumer(topic, consumer)

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const { runtime } = this
          await runtime.postgres.transact(async (client) => {
            await handler([message], client)
          })
        }
      })

      return consumer
    }))
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof RuntimeKafka)) return new RuntimeKafka(config, runtime)
}
