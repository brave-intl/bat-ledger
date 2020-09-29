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
  }

  async connect () {
    // testing only
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Kafka producer not allowed in production')
    }

    const partitionCount = 1

    this._producer = new NProducer(this.config, null, partitionCount)
    this._producer.on('error', error => {
      console.error(error)
      if (this.runtime.captureException) {
        this.runtime.captureException(error)
      }
    })
    await this._producer.connect()
  }

  async producer () {
    if (this._producer) {
      return this._producer
    }
    await this.connect()
    return this._producer
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
          debug('discontinuing topic processing', { topic })
        }
      }, false, false, batchOptions)
      return consumer
    }))
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof Kafka)) return new Kafka(config, runtime)
}
