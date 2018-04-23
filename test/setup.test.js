const request = require('supertest')
const { v4 } = require('uuid')
const site = v4()
const uuid1 = v4()
const uuid2 = v4()
const owner = `publishers#${uuid1}:${uuid2}`
const publisher = `mysite-${site}.com`
const posterURL = '/v2/publishers/blacklist/'
const tkn = 'foobarfoobar'
const token = `Bearer ${tkn}`
module.exports = {
  owner,
  publisher,
  req
}

function req ({ url, method, domain }) {
  return request(domain)[method || 'get'](url).set('Authorization', token)
}

function getterURL (channel) {
  return posterURL + (channel || uniqueChannel())
}

function uniqueChannel () {
  const unique = uuid.v4().toLowerCase()
  const uniqueChannel = `mysite-${unique}.com`
  // is this step necessary?
  return encodeURIComponent(uniqueChannel)
}

function createOwnerId () {
  const uuid1 = uuid.v4()
  const uuid2 = uuid.v4()
  return `publishers#${uuid1}:${uuid2}`
}
