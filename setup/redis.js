const redis = require('redis')
Promise.all([
  flush({
    host: 'redis'
  })
]).then(
  () => process.exit(0),
  () => process.exit(1)
)

function flush(...args) {
  const client = redis.createClient(...args)
  return new Promise((resolve, reject) => {
    client.flushdb((err, succeeded) => {
      console.log(...args, err, succeeded)
      if (err) {
        console.error(err)
        return reject(err)
      } else {
        resolve()
      }
    })
  })
}