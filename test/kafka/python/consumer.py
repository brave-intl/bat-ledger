from kafka import KafkaConsumer
consumer = KafkaConsumer('ledgerfun', bootstrap_servers='localhost')
for msg in consumer:
    print(msg)
