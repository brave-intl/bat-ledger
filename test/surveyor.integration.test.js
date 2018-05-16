import request from 'supertest'
import test from 'ava'

function ok (res) {
  if (!res) return new Error('no response')

  if (res.status !== 200) return new Error(JSON.stringify(res.body, null, 2).replace(/\\n/g, '\n'))

  return res.body
}

const srv = { listener: process.env.BAT_LEDGER_SERVER || 'https://ledger-staging.mercury.basicattentiontoken.org' }

test('verify batching endpoint does not error', async t => {
  const surveyorType = 'voting'
  const url = `/v2/batch/surveyor/${surveyorType}`
  const data = [ { surveyorId: '...', proof: '...' } ]

  await request(srv.listener).post(url).send(data).expect(ok)

  t.true(true)
})
