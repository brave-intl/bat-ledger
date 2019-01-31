import { serial as test } from 'ava'
import Postgres from 'bat-utils/lib/runtime-postgres'
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

const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})

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
  const { surveyorId: id } = publicSurveyor

  const ledger = await connectToDb('ledger')
  const surveyors = ledger.collection('surveyors', () => {})
  const privateSurveyor = await querySurveyor('findOne')

  const {
    surveyorType
  } = privateSurveyor
  const url = `/v2/surveyor/${surveyorType}/${encodeURIComponent(id)}`

  await ledgerAgent
    .get(url)
    .expect(ok)

  await timeout(5000)

  const privateFullSurveyor = await querySurveyor('findOne')
  cohorts.map((cohort) => {
    const surveyorCohortGrants = privateFullSurveyor.cohorts[cohort]
    t.true(_.isArray(surveyorCohortGrants), 'an array is present')
    t.true(surveyorCohortGrants.length > 0, 'the array is not empty')
  })

  await querySurveyor('remove')
  await postgres.query(`DELETE FROM surveyor_groups WHERE id = $1::text;`, [id])

  function querySurveyor (method) {
    return surveyors[method]({
      surveyorId: id
    })
  }
})
