import request from 'supertest'
import test from 'ava'
import _ from 'underscore'
import uuid from 'uuid'
import { isURL } from 'validator'
import dotenv from 'dotenv'
import querystring from 'querystring'
import { parse as URLparse } from 'url'
dotenv.config()

const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))

const {
  BAT_EYESHADE_SERVER: listener = 'https://eyeshade-staging.mercury.basicattentiontoken.org'
} = process.env
const posterURL = '/v2/publishers/blacklist/'
test('blacklist > GET > retrieve all', async t => {
  t.plan(2)
  const url = posterURL
  const response = await req({
    url
  })
  const {
    status,
    body
  } = response
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
    status: postStatus
  } = response
  t.true(postStatus === 200)
  response = await req({
    url: getterURL(channel)
  })
  const {
    body: getBody,
    status: getStatus
  } = response
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
    status: postStatus
  } = response
  t.true(postStatus === 200)
  // the publisher is in the db
  response = await req({
    url: posterURL,
    method: 'delete'
  }).send({
    publishers
  })
  const {
    status: deleteStatus
  } = response
  t.true(deleteStatus === 200)
  // the publisher is no longer in the db
  response = await req({
    url: getterURL(channel)
  })
  const {
    body: getBody,
    status: getStatus
  } = response
  t.true(getStatus === 404)
  t.true(_.isObject(getBody))
})
test('blacklist > throws in the report-publishers-contributions report generation', async t => {
  t.plan(3)
  let response = null
  const channel = uniqueChannel()
  const publishers = [channel]
  response = await req({
    url: posterURL,
    method: 'post'
  }).send({
    publishers
  })
  const query = querystring.stringify({
    blacklisted: true
  })
  // exists
  const url = `/v1/reports/publishers/contributions?${query}`
  response = await req({
    url
  })
  const {
    body: getBody,
    status: getStatus
  } = response
  const {
    reportURL
  } = getBody
  t.true(getStatus === 200)
  t.true(isURL(reportURL))

  do {
    let pathname = URLparse(reportURL).pathname
    await timeout(5000)
    response = await req({
      url: pathname
    })
  } while (response.status !== 200)
  const {
    status: checkStatus
  } = response
  t.true(checkStatus === 200)
})
test.serial('ensure PUT /v1/owners/{owner}/wallet updates correctly', async t => {
  t.plan(2)
  let body
  let status
  const url = `/v1/owners/${owner}/wallet`
  const options = { url, method: 'put' }
  const provider = 'none'
  const parameters = {}
  const data = {
    provider,
    parameters
  }
  const result = await req(options).send(data)
  status = result.status
  body = result.body
  t.true(status === 200)
  t.true(_.isObject(body))
})