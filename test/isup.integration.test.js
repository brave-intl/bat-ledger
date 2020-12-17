const { serial: test } = require('ava')
const { agent } = require('supertest')
const _ = require('underscore')
const {
  ok
} = require('./utils')
const { goneRoutes } = require('bat-utils/lib/hapi-server')

const {
  BAT_EYESHADE_SERVER
} = process.env

test('check endpoint is up with no authorization', async (t) => {
  await checkIsUp(BAT_EYESHADE_SERVER, 'ack.')

  async function checkIsUp (origin, expectation) {
    const {
      text
    } = await agent(origin)
      .get('/')
      .expect(ok)
    t.is(expectation, text, 'a fixed string is sent back')
  }
})

test('check endpoints return resource gone', async (t) => {
  t.plan(goneRoutes.length)
  await Promise.all(goneRoutes.map(({ method, path }) => {
    t.true(_.isString(path))
    return agent(BAT_EYESHADE_SERVER)[method.toLowerCase()](path)
      .expect(410) // will err without
  }))
})
