const redis = require('redis')
const client = redis.createClient()

client.flushdb((err, succeeded) => {
  if (err) {
    console.error(err)
    return process.exit(1)
  }
  process.exit(0)
})
