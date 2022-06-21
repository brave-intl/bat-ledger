const { Kafka, logLevel } = require('kafkajs')
const net = require('net')
const tls = require('tls')

// const batchOptions = {
//   batchSize: +(process.env.KAFKA_BATCH_SIZE || 10), // decides on the max size of our "batchOfMessages"
//   commitEveryNBatch: 1, // will be ignored
//   concurrency: 1, // will be ignored
//   commitSync: false, // will be ignored
//   noBatchCommits: true, // important, because we want to commit manually
//   manualBatching: true, // important, because we want to control the concurrency of batches ourselves
//   sortedManualBatch: true // important, because we want to receive the batch in a per-partition format for easier processing
// }

class RuntimeKafka {
  constructor (config, runtime) {
    const { kafka } = config;
    if (!kafka) {
      return;
    }
    
    this.runtime = runtime;
    this.config = kafka;
    this.topicHandlers = {};
    this.topicConsumers = {};
    this.kafka = new Kafka({
      ...kafka,
      // 'logLevel': logLevel.DEBUG,
      // socketFactory: myCustomSocketFactory,
      // ssl: true,
    });
  }

  async connect () {
    const producer = this.kafka.producer();    
    this._producer = producer
    
    producer.on('error', error => {
      console.error(error)
      if (this.runtime.captureException) {
        this.runtime.captureException(error)
      }
    });
    console.log("$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$")
    await producer.connect()
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@")
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
    // return await producer.send("my-topic", "my-message", 0, "my-key")
    const producer = await this.producer()
    return producer.send({topic: topicName, 
                          messages: [{key: _key, value: message, partition: _partition}],
                          acks: this.config['acks']
                        });
  }

  on (topic, handler) {
    this.topicHandlers[topic] = handler
  }

  consume () {
    return Promise.all(Object.keys(this.topicHandlers).map(async (topic) => {
      const handler = this.topicHandlers[topic]
      console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')

      const consumer = this.kafka.consumer({ groupId: this.config.clientId });
      await consumer.connect();
      await consumer.subscribe({ topics: [topic] });
      this.addTopicConsumer(topic, consumer)
      
      await consumer.run({
        partitionsConsumedConcurrently: 1,
        eachBatch: (async ({batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, uncommittedOffsets, isRunning, isStale}) => {
          console.log("* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * ")
          console.log(batch)
          const { runtime } = this;
          try {
            await runtime.postgres.transact(async (client) => {
              await handler(batch.messages, client);
              await heartbeat();
            })
          } catch (e) {
            runtime.captureException(e, { extra: { topic } })
            debug('discontinuing topic processing', {
              topic,
              e,
              message: e.message,
              stack: e.stack
            })
          }
        })
      });
      
      return consumer;
    }))
  }
}

module.exports = function (config, runtime) {
  if (!(this instanceof RuntimeKafka)) return new RuntimeKafka(config, runtime)
}
