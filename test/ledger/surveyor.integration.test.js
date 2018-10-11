import { serial as test } from 'ava'
import {
  ledgerAgent,
  cleanDbs,
  ok
} from '../utils'

test.after(cleanDbs)

test('verify voting batching endpoint does not error', async t => {
  const surveyorType = 'voting'
  const url = `/v2/batch/surveyor/${surveyorType}`
  const data = [ { surveyorId: '...', proof: '...' } ]

  await ledgerAgent.post(url).send(data).expect(ok)

  t.true(true)
})

test('verify surveyor batching endpoint does not error', async t => {
  const url = `/v2/batch/surveyor/16457ddb9913cd7928d3205ab455ecd`

  await ledgerAgent.get(url).expect(ok)

  t.true(true)
})
