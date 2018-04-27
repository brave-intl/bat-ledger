const request = require('supertest')
const { v4 } = require('uuid')
const site = v4()
const uuid1 = v4()
const uuid2 = v4()
const uuid3 = v4()
const owner = `publishers#uuid:${uuid1}`
const publisher = `youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg`
const posterURL = '/v2/publishers/blacklist/'
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
