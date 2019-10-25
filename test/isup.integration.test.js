import { serial as test } from 'ava'
import { agent } from 'supertest'
import {
  ok
} from './utils'

test('check endpoint is up with no authorization', async (t) => {
  const {
    BAT_BALANCE_SERVER,
    BAT_EYESHADE_SERVER,
    BAT_LEDGER_SERVER,
    BAT_REDEEMER_SERVER,
    BAT_GRANT_SERVER
  } = process.env

  await checkIsUp(BAT_BALANCE_SERVER, 'ack.')
  await checkIsUp(BAT_EYESHADE_SERVER, 'ack.')
  await checkIsUp(BAT_LEDGER_SERVER, 'ack.')
  await checkIsUp(BAT_GRANT_SERVER, '.')
  await checkIsUp(BAT_REDEEMER_SERVER, '.')

  async function checkIsUp (origin, expectation) {
    const {
      text
    } = await agent(origin)
      .get('/')
      .expect(ok)
    t.is(expectation, text, 'a fixed string is sent back')
  }
})
