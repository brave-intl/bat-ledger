#!/bin/bash

openssl genrsa -des3 -passout "pass:confluent" -out consumer.client.key 1024
openssl req -passin "pass:confluent" -passout "pass:confluent" -key consumer.client.key -new -out consumer.client.req -subj '/CN=consumer.test.confluent.io/OU=TEST/O=CONFLUENT/L=PaloAlto/S=Ca/C=US'
openssl x509 -req -CA snakeoil-ca-1.crt -CAkey snakeoil-ca-1.key -in consumer.client.req -out consumer-ca1-signed.pem -days 9999 -CAcreateserial -passin "pass:confluent"
