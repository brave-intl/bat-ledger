import request from 'supertest'
import test from 'ava'
import _ from 'underscore'
import uuid from 'uuid'

function ok (res) {
  if (res.status !== 200) {
    return new Error(JSON.stringify(res.body, null, 2).replace(/\\n/g, '\n'))
  }
}

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms))

const tkn = 'foobarfoobar'
const token = `Bearer ${tkn}`
const {
  BAT_EYESHADE_SERVER = 'https://eyeshade-staging.mercury.basicattentiontoken.org'
} = process.env
const srv = {
  listener: BAT_EYESHADE_SERVER
}
const posterURL = '/v2/publishers/blacklist/'
test('blacklist > GET > retrieve all', async t => {
  t.plan(2)
  const url = posterURL
  const response = await req({ url })
  const {
    status,
    body
  } = response
  console.log(status, body)
  t.true(status === 200)
  t.true(_.isArray(body))
})
test('blacklist > GET > does not find if not in blacklist', async t => {
  t.plan(1)
  const url = getterURL()
  // should never find unique publisher channel
  const response = await req({ url })
  const {
    status: getStatus
  } = response
  // console.log('failure get', getStatus)
  t.true(getStatus === 404)
})
test('blacklist > finds if has been added to blacklist', async t => {
  t.plan(3)
  let response = null
  const channel = uniqueChannel()
  const publishers = [channel]
  // should never find unique publisher channel
  response = await req({
    url: posterURL,
    method: 'post'
  }).send({
    publishers
  })
  const {
    status: postStatus,
    body: postBody
  } = response
  // console.log('successful post', postStatus, postBody)
  t.true(postStatus === 200)
  response = await req({
    url: getterURL(channel)
  })
  const {
    body: getBody,
    status: getStatus
  } = response
  // console.log('successful get', getStatus, getBody)
  t.true(getStatus === 200)
  t.true(_.isObject(getBody))
})
test('blacklist > removes with the delete method', async t => {
  t.plan(4)
  let response = null
  const channel = uniqueChannel()
  const publishers = [channel]
  // should never find unique publisher channel
  response = await req({
    url: posterURL,
    method: 'post'
  }).send({
    publishers
  })
  const {
    status: postStatus,
    body: postBody
  } = response
  // console.log('successful post', postStatus, postBody)
  t.true(postStatus === 200)
  // the publisher is in the db
  response = await req({
    url: posterURL,
    method: 'delete'
  }).send({
    publishers
  })
  const {
    status: deleteStatus,
    body: deleteBody
  } = response
  // console.log('successful delete', deleteStatus, deleteBody)
  t.true(deleteStatus === 200)
  // the publisher is no longer in the db
  response = await req({
    url: getterURL(channel)
  })
  const {
    body: getBody,
    status: getStatus
  } = response
  // console.log('successful get', getStatus, getBody)
  t.true(getStatus === 404)
  t.true(_.isObject(getBody))
})

function req({ url, method }) {
  return request(srv.listener)[method ? method : 'get'](url)
    .set('Authorization', token)
}

function getterURL(channel) {
  return posterURL + (channel || uniqueChannel())
}

function uniqueChannel() {
  const unique = uuid.v4().toLowerCase()
  const uniqueChannel = `mysite-${unique}.com`
  // is this step necessary?
  return encodeURIComponent(uniqueChannel)
}
