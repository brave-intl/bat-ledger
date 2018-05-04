const http = require('http')
module.exports = (path, data) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      protocol: 'http:',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer foobarfoobar'
      }
    }
    const req = http.request(options, (res) => {
      console.log(`STATUS: ${res.statusCode}`)
      console.log(`HEADERS: ${JSON.stringify(res.headers)}`)
      res.setEncoding('utf8')
      res.on('end', () => {
        console.log('No more data in response.')
        resolve()
      })
    })
    req.on('error', (err) => {
      console.error(err)
      reject(err)
    })
    req.write(JSON.stringify(data))
    req.end()
  })
}
