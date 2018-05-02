const request = require('supertest')
const { v4 } = require('uuid')
const uuid1 = v4()
const owner = `publishers#uuid:${uuid1}`
const publisher = `youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg`
const tkn = 'foobarfoobar'
const token = `Bearer ${tkn}`
const {
  BAT_EYESHADE_SERVER: eyeshade = 'https://eyeshade-staging.mercury.basicattentiontoken.org',
  BAT_LEDGER_SERVER: ledger = 'https://ledger-staging.mercury.basicattentiontoken.org'
} = process.env
const votes = ['wikipedia.org', 'reddit.com', 'youtube.com', 'ycombinator.com', 'google.com', publisher]
module.exports = {
  owner,
  publisher,
  req,
  ok,
  eyeshade,
  ledger,
  votes,
  timeout,
  fetchReport
}

function req ({
  domain,
  method,
  url,
  expect
}) {
  const req = request(domain)[method || 'get'](url).set('Authorization', token)
  if (!expect) {
    return req
  }
  const isTrue = expect === true
  const status = isTrue ? 200 : expect
  const bound = check.bind(null, status)
  return req.expect(bound)
}

function check (expected, { status, body }) {
  if (status !== expected) {
    return new Error(JSON.stringify(body, null, 2).replace(/\\n/g, '\n'))
  }
}

function ok (req) {
  return check(200, req)
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// write an abstraction for the do while loops
async function tryAfterMany (ms, theDoBlock, theCatchBlock) {
  let tryagain = null
  let result = null
  do {
    tryagain = false
    try {
      result = await theDoBlock()
      tryagain = theCatchBlock(null, result)
    } catch (e) {
      tryagain = theCatchBlock(e, result)
    }
    if (tryagain) {
      await timeout(ms)
    }
  } while (tryagain)
  return result
}

async function fetchReport ({
  domain,
  reportId,
  isCSV
}) {
  let url = `/v1/reports/file/${reportId}`
  return tryAfterMany(5000,
    () => req({ url, domain }),
    (e, result) => {
      if (e) {
        throw e
      }
      const {
        statusCode,
        headers
      } = result
      if (isCSV) {
        return headers['content-type'].indexOf('text/csv') === -1
      }
      if (statusCode < 400) {
        return false
      }
      const tryagain = statusCode === 404
      if (!tryagain) {
        throw result
      }
      return tryagain
    })
}
