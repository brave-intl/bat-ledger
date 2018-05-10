import {
  serial as test
} from 'ava'
import _ from 'underscore'
import uuid from 'uuid'
import {
  isURL
} from 'validator'
import dotenv from 'dotenv'
import querystring from 'querystring'
import {
  publisher,
  // only using eyeshade here
  eyeshade as domain,
  fetchReport,
  req
} from 'test/setup.test'
dotenv.config()

const channel = uniqueChannel()
const expect = 200
const posterURL = '/v2/publishers/blacklist/'
test('blacklist > GET > retrieve all', async t => {
  t.plan(1)
  const response = await req({
    url: posterURL,
    domain,
    expect
  })
  const {
    body
  } = response
  t.true(_.isArray(body))
})
test('blacklist > GET > does not find if not in blacklist', async t => {
  t.plan(0)
  // creates unique
  const url = getterURL(channel)
  // should never find unique publisher channel
  // const response =
  await req({
    url,
    domain,
    expect: 404
  })
})
test('blacklist > finds if has been added to blacklist', async t => {
  t.plan(1)
  // creates a new channel
  const publishers = [channel]
  // add to blacklist
  await req({
    url: posterURL,
    method: 'post',
    domain,
    expect
  }).send({
    publishers
  })
  const checker = await req({
    url: getterURL(channel),
    domain,
    expect
  })
  const getBody = checker.body
  t.is(getBody.publisher, channel)
})
test('blacklist > removes with the delete method', async t => {
  t.plan(1)
  const channel = uniqueChannel()
  const publishers = [channel]
  // should never find unique publisher channel
  await req({
    url: posterURL,
    method: 'post',
    domain,
    expect
  }).send({
    publishers
  })
  // the publisher is in the db
  await req({
    url: posterURL,
    method: 'delete',
    domain,
    expect
  }).send({
    publishers
  })
  // the publisher is no longer in the db
  const checkResponse = await req({
    url: getterURL(channel),
    expect: 404,
    domain
  })
  const getBody = checkResponse.body
  t.true(_.isObject(getBody))
})
test('blacklist > report-publishers-contributions generation', async t => {
  t.plan(2)
  const publishers = [publisher]
  // clear the db if it exists because of error or otherwise
  await req({
    url: posterURL,
    method: 'delete',
    expect,
    domain
  }).send({
    publishers
  })
  await req({
    url: posterURL,
    method: 'post',
    expect,
    domain
  }).send({
    publishers
  })
  const blacklisted = true
  const query = querystring.stringify({
    blacklisted
  })
  const contributionUrl = `/v1/reports/publishers/contributions?${query}`
  const contributionsReportResponse = await req({
    url: contributionUrl,
    expect,
    domain
  })
  const getBody = contributionsReportResponse.body
  const {
    reportURL,
    reportId
  } = getBody
  t.true(isURL(reportURL))
  const report = await fetchReport({
    domain,
    reportId
  })
  const reportBody = report.body
  await req({
    url: posterURL,
    method: 'delete',
    expect,
    domain
  }).send({
    publishers
  })
  t.true(_.isString(reportBody.reason))
})

function getterURL (channel) {
  return posterURL + (channel || uniqueChannel())
}

function uniqueChannel () {
  const unique = uuid.v4().toLowerCase()
  const uniqueChannel = `mysite-${unique}.com`
  // is this step necessary?
  return encodeURIComponent(uniqueChannel)
}
