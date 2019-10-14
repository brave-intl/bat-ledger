const avro = require('avsc');
const kafka = require('kafka-node');
const client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'});
const producer = new kafka.Producer(client);

const type = avro.Type.forSchema({
  type: 'record',
  name: 'PingInfo',
  fields: [
    {name: 'ping', type: 'string'}
  ]
});


producer.on('ready', function () {
  console.log("ready")

  function loop() {
    setTimeout(function () {
      console.log("ping!")
			const buf = type.toBuffer({ping: 'pong'}); // Encoded buffer.

      producer.send([{topic: 'ledgerfun', messages: [buf]}], function (err, data) {
          console.log(data);
      });
      loop();
    }, 1000);
  }
  loop();
});
