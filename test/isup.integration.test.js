import { serial as test } from 'ava'
import { agent } from 'supertest'
import _ from 'underscore'
import { ok } from './utils.js'
import { goneRoutes } from 'bat-utils/lib/hapi-server.js'

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
