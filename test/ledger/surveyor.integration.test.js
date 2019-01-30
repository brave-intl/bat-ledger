import { serial as test } from 'ava'
import _ from 'underscore'
import {
  timeout
} from 'bat-utils/lib/extras-utils'
import {
  connectToDb,
  createSurveyor,
  ledgerAgent,
  cleanDbs,
  ok
} from '../utils'

test.after.always(cleanDbs)

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

test('required cohorts are added to surveyors', async (t) => {
  const { VOTING_COHORTS } = process.env
  const cohorts = VOTING_COHORTS ? VOTING_COHORTS.split(',') : []
  console.log('testing cohorts', cohorts)
  t.plan((cohorts.length * 2) + 1)
  t.true(cohorts.length >= 1)
  const {
    body: publicSurveyor
  } = await createSurveyor()

  const ledger = await connectToDb('ledger')
  const surveyors = ledger.collection('surveyors', () => {})
  const privateSurveyor = await getSurveyor()

  const {
    surveyorId,
    surveyorType
  } = privateSurveyor
  const url = `/v2/surveyor/${surveyorType}/${surveyorId}`

  await ledgerAgent
    .get(url)
    .expect(ok)

  await timeout(5000)

  const privateFullSurveyor = await getSurveyor()
  cohorts.map((cohort) => {
    const surveyorCohortGrants = privateFullSurveyor.cohorts[cohort]
    t.true(_.isArray(surveyorCohortGrants), 'an array is present')
    t.true(surveyorCohortGrants.length > 0, 'the array is not empty')
  })

  function getSurveyor () {
    return surveyors.findOne({
      surveyorId: publicSurveyor.surveyorId
    })
  }
})
