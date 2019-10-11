from kafka import KafkaProducer
import logging
import time
logging.basicConfig(level=logging.DEBUG)
producer = KafkaProducer(bootstrap_servers='localhost')

while True:
    future = producer.send('ledgerfun', b'ping!')
    ult = future.get(timeout=60)
    print('sent')
    time.sleep(1)
