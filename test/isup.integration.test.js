import { serial as test } from 'ava'
import { agent } from 'supertest'
import {
  ok
} from './utils'

test('check endpoint is up with no authorization', async (t) => {
  const {
    BAT_BALANCE_SERVER,
    BAT_EYESHADE_SERVER,
    BAT_LEDGER_SERVER
  } = process.env

  await checkIsUp(BAT_BALANCE_SERVER)
  await checkIsUp(BAT_EYESHADE_SERVER)
  await checkIsUp(BAT_LEDGER_SERVER)

  async function checkIsUp (origin) {
    const {
      text
    } = await agent(origin)
      .get('/')
      .expect(ok)
    t.is('ack.', text, 'a fixed string is sent back')
  }
})
