package main

import (
  "time"
  "fmt"
  "context"
  "github.com/segmentio/kafka-go"
)

func main() {
  // make a writer that produces to topic-A, using the least-bytes distribution
  w := kafka.NewWriter(kafka.WriterConfig{
    Brokers: []string{"localhost:9092"},
    Topic:   "ledgerfun",
    Balancer: &kafka.LeastBytes{},
  })

  for {
    fmt.Printf("Ping!\n")
    w.WriteMessages(context.Background(),
      kafka.Message{
        //Key:   []byte("Key-C"),
        Value: []byte("Ping!"),
      },
    )
    time.Sleep(1 * time.Millisecond)
  }

  w.Close()
}
