// curl -X POST --header 'Authorization: Bearer foobarfoobar' --header 'Content-Type: application/json' --header 'Accept: application/json' -d '{"adFree":{"fee":{"USD":5},"votes":5,"altcurrency":"BAT","probi":"27116311373482831368"}}' 'http://127.0.0.1:3001/v2/surveyor/contribution'
const http = require('http')
const options = {
  hostname: 'localhost',
  protocol: 'http:',
  port: 3001,
  path: '/v2/surveyor/contribution',
  method: 'POST',
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": "Bearer foobarfoobar",
  },
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
const data = {"adFree":{"fee":{"USD":5},"votes":5,"altcurrency":"BAT","probi":"27116311373482831368"}}
req.write(JSON.stringify(data))
req.end()
