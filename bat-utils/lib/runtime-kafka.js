const { NConsumer, NProducer } = require('sinek')
const SDebug = require('sdebug')
const debug = new SDebug('kafka')

const batchOptions = {
  batchSize: +(process.env.KAFKA_BATCH_SIZE || 10), // decides on the max size of our "batchOfMessages"
  commitEveryNBatch: 1, // will be ignored
  concurrency: 1, // will be ignored
  commitSync: false, // will be ignored
  noBatchCommits: true, // important, because we want to commit manually
  manualBatching: true, // important, because we want to control the concurrency of batches ourselves
  sortedManualBatch: true // important, because we want to receive the batch in a per-partition format for easier processing
}

class Kafka {
  constructor (config, runtime) {
    const { kafka } = config
    if (!kafka) {
      return
    }
    this.runtime = runtime
    this.config = kafka
    this.topicHandlers = {}
    this.topicConsumers = {}
  }

  async connect () {
    if (this.connecting) {
      return this.connecting
    }
    const partitionCount = 1

    const producer = new NProducer(this.config, null, partitionCount)
    this._producer = producer
    producer.on('error', error => {
      console.error(error)
      if (this.runtime.captureException) {
        this.runtime.captureException(error)
      }
    })
    const connecting = producer.connect()
    this.connecting = connecting
    return connecting
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

  async sendMany ({ topic, encode }, messages, _partition = null, _key = null, _partitionKey = null) {
    // map twice to err quickly on input errors
    // use map during send to increase batching on network
    return Promise.all(
      messages.map(encode)
        .map((msg) =>
          this.send(topic, msg, _partition, _key, _partitionKey)
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
    for (let i = 0; i < msgs.length; i += 1) {
      results.push(await fn(msgs[i].value, msgs[i].timestamp))
    }
    return results
  }

  async send (topicName, message, _partition = null, _key = null, _partitionKey = null) {
    // return await producer.send("my-topic", "my-message", 0, "my-key", "my-partition-key")
    const producer = await this.producer()
    return producer.send(topicName, message, _partition, _key, _partitionKey)
  }

  on (topic, handler) {
    this.topicHandlers[topic] = handler
  }

  consume () {
    return Promise.all(Object.keys(this.topicHandlers).map(async (topic) => {
      const handler = this.topicHandlers[topic]
      const consumer = new NConsumer([topic], this.config)
      await consumer.connect()
      this.addTopicConsumer(topic, consumer)
      consumer.consume(async (batchOfMessages, callback) => {
        // parallel processing on topic level
        const { runtime } = this
        try {
          await runtime.postgres.transact(async (client) => {
            const partitions = batchOfMessages[topic]
            // parallel processing on partition level
            const partitionKeys = Object.keys(partitions)
            for (let i = 0; i < partitionKeys.length; i += 1) {
              const messages = partitions[partitionKeys[i]]
              await handler(messages, client)
            }
          })
          // wait until all partitions of this topic are processed and commit its offset
          // make sure to keep batch sizes large enough, you dont want to commit too often
          // callback still controlls the "backpressure"
          // as soon as you call it, it will fetch the next batch of messages
          await consumer.commitLocalOffsetsForTopic(topic)
          callback()
        } catch (e) {
          runtime.captureException(e, { extra: { topic } })
          debug('discontinuing topic processing', {
            topic,
            e,
            message: e.message,
            stack: e.stack
          })
        }
      }, false, false, batchOptions)
      return consumer
    }))
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof Kafka)) return new Kafka(config, runtime)
}
