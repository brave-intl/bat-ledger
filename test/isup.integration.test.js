const { serial: test } = require('ava')
const { agent } = require('supertest')
const {
  ok
} = require('./utils')

test('check endpoint is up with no authorization', async (t) => {
  const {
    BAT_EYESHADE_SERVER
  } = process.env

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
