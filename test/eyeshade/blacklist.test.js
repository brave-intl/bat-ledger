import {
  serial as test
} from 'ava'
import _ from 'underscore'
import uuid from 'uuid'
import dotenv from 'dotenv'
import querystring from 'querystring'
import {
  fetchReport,
  eyeshadeAgent,
  ok,
  status
} from 'test/utils'
dotenv.config()

const channel = uniqueChannel()
const posterURL = '/v2/publishers/blacklist/'
test('blacklist > GET > retrieve all', async t => {
  t.plan(1)
  const response = await eyeshadeAgent.get(posterURL).expect(ok)
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
  await eyeshadeAgent.get(url).expect(status(404))
})
test('blacklist > finds if has been added to blacklist', async t => {
  t.plan(1)
  // creates a new channel
  const publishers = [channel]
  // add to blacklist
  await eyeshadeAgent.post(posterURL).send({
    publishers
  }).expect(ok)
  const checker = await eyeshadeAgent.get(getterURL(channel)).expect(ok)
  const getBody = checker.body
  t.is(getBody.publisher, channel)
})
test('blacklist > removes with the delete method', async t => {
  t.plan(1)
  const channel = uniqueChannel()
  const publishers = [channel]
  // should never find unique publisher channel
  await eyeshadeAgent.post(posterURL).send({
    publishers
  }).expect(ok)
  // the publisher is in the db
  await eyeshadeAgent.del(posterURL).send({
    publishers
  }).expect(ok)
  // the publisher is no longer in the db
  const checkResponse = await eyeshadeAgent.get(getterURL(channel)).expect(status(404))
  const getBody = checkResponse.body
  t.true(_.isObject(getBody))
})
test('blacklist > report-publishers-contributions generation', async t => {
  t.plan(2)
  const publishers = [channel]
  // clear the db if it exists because of error or otherwise
  console.log('publishers', publishers)
  await eyeshadeAgent.del(posterURL).send({
    publishers
  }).expect(ok)
  await eyeshadeAgent.post(posterURL).send({
    publishers
  }).expect(ok)
  const blacklisted = true
  const query = querystring.stringify({
    blacklisted
  })
  const contributionUrl = `/v1/reports/publishers/contributions?${query}`
  const contributionsReportResponse = await eyeshadeAgent.get(contributionUrl).expect(ok)
  const getBody = contributionsReportResponse.body
  const {
    reportURL
  } = getBody
  t.true(_.isString(reportURL))
  const report = await fetchReport({ url: reportURL })
  const reportBody = report.body
  await eyeshadeAgent.del(posterURL).send({
    publishers
  }).expect(ok)
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
