const kafka = require('kafka-node')
//Producer = kafka.Producer,
const client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'})
//producer = new Producer(client);
const consumer = new kafka.Consumer(client, [{topic: 'ledgerfun'}])
consumer.on('message', function (message) {
      console.log(message);
});
