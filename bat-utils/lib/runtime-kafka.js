const kafka = require('kafka-node')
const SDebug = require('sdebug')
const debug = new SDebug('kafka')

class Kafka {
  constructor (config, runtime) {
    const { kafka } = config
    if (!kafka) {
      return
    }
    this.runtime = runtime
    this.config = kafka
  }
  consume (topics, handler) {
    const options = this.config()
    const consumer = new kafka.ConsumerGroup(options, topics)
    consumer.on('message', this.handleMessage(handler))
    consumer.on('error', this.runtime.captureException)
    // consumer.on('offsetOutOfRange', () => {})
  }
  handleMessage (handler) {
    return async (data) => {
      for (const key in data) {
        const partitions = data[key]
        for (const index in partitions) {
          const message = partitions[index]
          await handler(debug, this.runtime, ...message)
        }
      }
    }
  }
  config () {
    return Object.assign({
      kafkaHost: process.env.KAFKA_BROKER,
      batch: undefined, // put client batch settings if you need them
      ssl: true, // optional (defaults to false) or tls options hash
      groupId: 'bat-ledger',
      fetchMaxBytes: 1024 * 1024,
      sessionTimeout: 15000,
      // An array of partition assignment protocols ordered by preference.
      // // 'roundrobin' or 'range' string for built ins (see below to pass in custom assignment protocol)
      // protocol: ['roundrobin'],
      encoding: 'utf8', // default is utf8, use 'buffer' for binary data
      keyEncoding: 'utf8',
      // Offsets to use for new groups other options could be 'earliest' or 'none' (none will emit an error if no offsets were saved)
      // equivalent to Java client's auto.offset.reset
      fromOffset: 'latest', // default
      commitOffsetsOnFirstJoin: true, // on the very first time this consumer group subscribes to a topic, record the offset returned in fromOffset (latest/earliest)
      // how to recover from OutOfRangeOffset error (where save offset is past server retention) accepts same value as fromOffset
      outOfRangeOffset: 'earliest' // default
      // // Callback to allow consumers with autoCommit false a chance to commit before a rebalance finishes
      // // isAlreadyMember will be false on the first connection, and true on rebalances triggered after that
      // onRebalance: (isAlreadyMember, callback) => callback() // or null
    }, this.config.connection)
  }
}

module.exports = Kafka
