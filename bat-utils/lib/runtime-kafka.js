const { NConsumer, NProducer } = require('sinek')

const kafkaConfiguration = {
  noptions: {
    'metadata.broker.list': process.env.KAFKA_BROKERS,
    'group.id': process.env.KAFKA_CONSUMER_GROUP,
    'socket.keepalive.enable': true,
    'api.version.request': true,
    'socket.blocking.max.ms': 100
  },
  tconf: {
    'request.required.acks': 1, // FIXME testing only
    'auto.offset.reset': 'earliest'
  }
}

const batchOptions = {
  batchSize: 1000, // decides on the max size of our "batchOfMessages"
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
    // FIXME testing only
    const partitionCount = 1

    this.producer = new NProducer(kafkaConfiguration, null, partitionCount)
    this.producer.on('error', error => {
      console.error(error)
      this.runtime.captureException(error)
    })
    await this.producer.connect()
  }
  async send (topicName, message, _partition = null, _key = null, _partitionKey = null) {
    // return await producer.send("my-topic", "my-message", 0, "my-key", "my-partition-key")
    return this.producer.send(topicName, message, _partition, _key, _partitionKey)
  }
  on (topic, handler) {
    this.topicHandlers[topic] = handler
  }
  async consume () {
    const consumer = new NConsumer(Object.keys(this.topicHandlers), kafkaConfiguration)
    await consumer.connect()
    consumer.consume(async (batchOfMessages, callback) => {
      // parallel processing on topic level
      const topicPromises = Object.keys(batchOfMessages).map(async (topic) => {
        // parallel processing on partition level
        const partitionPromises = Object.keys(batchOfMessages[topic]).map((partition) => {
          // sequential processing on message level (to respect ORDER)
          const messages = batchOfMessages[topic][partition]

          return this.topicHandlers[topic](messages)
        })

        // wait until all partitions of this topic are processed and commit its offset
        // make sure to keep batch sizes large enough, you dont want to commit too often
        await Promise.all(partitionPromises)
        await consumer.commitLocalOffsetsForTopic(topic)
      })

      await Promise.all(topicPromises)
      // callback still controlls the "backpressure"
      // as soon as you call it, it will fetch the next batch of messages
      callback()
    }, true, false, batchOptions)
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof Kafka)) return new Kafka(config, runtime)
}
