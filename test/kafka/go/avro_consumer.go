package main

import (
  "fmt"
  "context"
  "github.com/segmentio/kafka-go"
  "github.com/linkedin/goavro"
)

func main() {
  r := kafka.NewReader(kafka.ReaderConfig{
      Brokers:   []string{"localhost:9092"},
      //GroupID:   "go-group-id",
      Topic:     "ledgerfun",
      Partition: 0,
      MinBytes:  10e3, // 10KB
      MaxBytes:  10e6, // 10MB
  })
  r.SetOffset(-1)

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


  ctx := context.Background()
  for {
      m, err := r.ReadMessage(context.Background())
      if err != nil {
        break
      }

      native, _, err := codec.NativeFromBinary(m.Value)
      if err != nil {
        fmt.Println(err)
      }

			buf, err := codec.TextualFromNative(nil, native)
			if err != nil {
        fmt.Println(err)
			}

      fmt.Printf("message at topic/partition/offset %v/%v/%v: %s = %s\n", m.Topic, m.Partition, m.Offset, string(m.Key), string(m.Value))
      fmt.Printf("decode: %s\n", string(buf))
      r.CommitMessages(ctx, m)
  }

  r.Close()
}
