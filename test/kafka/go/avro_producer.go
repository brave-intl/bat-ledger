package main

import (
  "time"
  "fmt"
  "context"
  "github.com/segmentio/kafka-go"
  "github.com/linkedin/goavro"
)

func main() {
  w := kafka.NewWriter(kafka.WriterConfig{
    Brokers: []string{"localhost:9092"},
    Topic:   "ledgerfun",
    Balancer: &kafka.LeastBytes{},
  })

  codec, err := goavro.NewCodec(`
      {
        "type": "record",
        "name": "PingInfo",
        "fields" : [
          {"name": "ping", "type": "string"}
        ]
      }`)
  if err != nil {
    fmt.Println(err)
  }
  textual := []byte(`{"ping": "pong"}`)
  native, _, err := codec.NativeFromTextual(textual)
  if err != nil {
    fmt.Println(err)
  }

  binary, err := codec.BinaryFromNative(nil, native)
  if err != nil {
    fmt.Println(err)
  }

  for {
    fmt.Printf("Ping!\n")
    w.WriteMessages(context.Background(),
      kafka.Message{
        Value: []byte(binary),
      },
    )
    time.Sleep(1 * time.Millisecond)
  }

  w.Close()
}
