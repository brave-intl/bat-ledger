const kafka = require('kafka-node')
const avro = require('avsc');
const client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'})
const consumer = new kafka.Consumer(client, [{topic: 'ledgerfun'}])

const type = avro.Type.forSchema({
  type: 'record',
  name: "PingInfo",
  fields: [
    {name: 'ping', type: 'string'}
  ]
});

consumer.on('message', function (message) {
  //console.log(message);
  //console.log(message.value);
  const value = Buffer.from(message.value, 'binary');
  const decode = type.fromBuffer(value);
  console.log(decode);
});
