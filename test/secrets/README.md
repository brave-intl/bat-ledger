Generated using https://github.com/confluentinc/cp-docker-images/blob/5.3.1-post/examples/kafka-mqtt-single-node-ssl-producer/secrets/create-certs.sh and generate-client.sh

run
```bash
rm broker1* consumer* kafka* snakeoil-ca*
./create-certs.sh
./generate-client.sh
```
when the cert expires next