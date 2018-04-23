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

// // publishers#uuidv4:uuidv4
// // const owner = createOwnerId()
// // const publisher = uniqueChannel()
// import {
//   owner,
//   publisher
// } from './setup.test'
// test.serial('create an owner', async t => {
//   t.plan(2)
//   const ownerName = 'venture'
//   const url = '/v1/owners'
//   const name = ownerName
//   const email = 'mmclaughlin@brave.com'
//   const phone = '+16122458588'
//   const ownerEmail = email
//   const authorizer = {
//     owner,
//     ownerEmail,
//     ownerName
//   }
//   const contactInfo = {
//     name,
//     email,
//     phone
//   }
//   const provider = {
//     publisher
//   }
//   const providers = [provider]
//   const data = {
//     authorizer,
//     contactInfo,
//     providers
//   }
//   const options = {
//     url,
//     method: 'post'
//   }
//   const result = await req(options).send(data)
//   const status = result.status
//   const body = result.body
//   t.true(status === 200)
//   t.true(_.isObject(body))
// })
// test.serial('ensure publisher verified with /v2/publishers/settlement', async t => {
//   t.plan(1)
//   const url = `/v2/publishers/settlement`
//   const method = 'post'
//   const altcurrency = 'BAT'
//   const probi = 10e18.toString()
//   const amount = '0.20'
//   const type = 'contribution'
//   const options = { url, method }
//   console.log('owner printed here', owner)
//   const datum = {
//     owner,
//     publisher,
//     altcurrency,
//     probi,
//     amount,
//     type
//   }
//   const datum1 = contribution(datum)
//   const datum2 = contribution(datum)
//   const data = [datum1, datum2]
//   const result = await req(options).send(data)
//   const { body, status } = result
//   t.true(status === 200)

//   function contribution(base) {
//     return _.extend({
//       address: uuid.v4(),
//       transactionId: uuid.v4(),
//       hash: uuid.v4()
//     }, base)
//   }
// })
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
// test('ensure GET /v1/owners/{owner}/wallet computes correctly', async t => {
//   t.plan(2)
//   const url = `/v1/owners/${encodeURIComponent(owner)}/wallet`
//   const options = { url }
//   let result = null
//   do {
//     console.log('owner', owner)
//     await timeout(5000)
//     result = await req(options)
//     // console.log(result.body)
//   } while (!Object.keys(result.body).length || !(+result.body.contributions.amount))
//   const { status, body } = result
//   console.log('GET /v1/owners/{owner}/wallet', status, body)
//   t.true(status === 200)
//   t.true(_.isObject(body))
// })
