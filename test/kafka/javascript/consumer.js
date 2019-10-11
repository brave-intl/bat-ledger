const kafka = require('kafka-node')
const client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'})
const consumer = new kafka.Consumer(client, [{topic: 'ledgerfun'}])
consumer.on('message', function (message) {
      console.log(message);
});
