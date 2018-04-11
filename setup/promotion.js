
const querystring = require('querystring')
const http = require('http')
const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/v1/grants',
  method: 'POST',
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": "Bearer foobarfoobar"
  }
}
const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`)
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`)
  res.setEncoding('utf8')
  res.on('end', () => {
    console.log('No more data in response.')
    process.exit(0)
  })
})
req.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
const data = {"grants": [ "eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ" ], "promotions": [{"active": true,"priority": 0,"promotionId": "902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3"}]}
req.write(JSON.stringify(data))
req.end()
