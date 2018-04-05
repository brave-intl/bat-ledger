import request from 'supertest'
import test from 'ava'
import _ from 'underscore'

function ok (res) {
  if (res.status !== 200) {
    return new Error(JSON.stringify(res.body, null, 2).replace(/\\n/g, '\n'))
  }
}

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms))

const {
  BAT_EYESHADE_SERVER = 'https://eyeshade-staging.mercury.basicattentiontoken.org'
} = process.env
const srv = {
  listener: BAT_EYESHADE_SERVER
}
test('blacklist > GET checks if publisher exists in blacklist', async t => {
  t.plan(1)
  let response = {}
  const channel = 'mysite.com'
  console.log('here')
  try {
  response = await request(srv.listener)
    .get(`/v2/publishers/blacklist/${encodeURIComponent(channel)}`)
    .expect(ok)
  } catch(err) {
    console.log(err)
    return t.true(_.isObject(err))
  }
  const { body } = response
  console.log(body)
  t.true(_.isObject(body))
})
