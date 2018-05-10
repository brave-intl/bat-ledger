const request = require('supertest')
const { v4 } = require('uuid')
const uuid1 = v4()
const owner = `publishers#uuid:${uuid1}`
const publisher = `youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg`
const tkn = 'foobarfoobar'
const token = `Bearer ${tkn}`
module.exports = {
  owner,
  publisher,
  req,
  ok
}

function req ({ domain, method, url, expect }) {
  const req = request(domain)[method || 'get'](url).set('Authorization', token)
  return expect ? req.expect(ok) : req
}

function ok ({ status, body }) {
  if (status !== 200) {
    return new Error(JSON.stringify(body, null, 2).replace(/\\n/g, '\n'))
  }
}
