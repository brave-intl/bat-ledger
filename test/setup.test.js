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
  req
}

function req ({ domain, method, url }) {
  return request(domain)[method || 'get'](url).set('Authorization', token)
}
