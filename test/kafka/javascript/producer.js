const kafka = require('kafka-node');
const client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'});
const producer = new kafka.Producer(client);

producer.on('ready', function () {
  console.log("ready")

  function loop() {
    setTimeout(function () {
      console.log("go again")
      producer.send([{'topic': 'ledgerfun', 'messages': ['ping!']}], function (err, data) {
          console.log(data);
      });
      loop();
    }, 1000);
  }
  loop();
});
