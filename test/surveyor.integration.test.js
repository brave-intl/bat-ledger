import test from 'ava'
import { ledgerAgent } from './utils'

function ok (res) {
  if (!res) return new Error('no response')

  if (res.status !== 200) return new Error(JSON.stringify(res.body, null, 2).replace(/\\n/g, '\n'))

  return res.body
}

test('verify batching endpoint does not error', async t => {
  const surveyorType = 'voting'
  const url = `/v2/batch/surveyor/${surveyorType}`
  const data = [ { surveyorId: '...', proof: '...' } ]

  await ledgerAgent.post(url).send(data).expect(ok)

  t.true(true)
})
