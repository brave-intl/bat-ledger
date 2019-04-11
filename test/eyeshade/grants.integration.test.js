'use strict'

import {
  serial as test
} from 'ava'
import uuidV4 from 'uuid/v4'
import _ from 'underscore'
import {
  ok,
  debug,
  cleanPgDb,
  eyeshadeAgent,
  braveYoutubePublisher
} from '../utils'
import {
  insert,
  insertGrant
} from '../../eyeshade/lib/grants'
import {
  workers
} from '../../eyeshade/workers/grants'

const {
  BAT_POSTGRES_URL
} = process.env
const selectAllGrants = `
SELECT
  id,
  created_at as "createdAt",
  promotion_id as "promotionId",
  type,
  cohort,
  channel,
  amount
FROM grants;`
const Postgres = require('bat-utils/lib/runtime-postgres')
const postgres = new Postgres({
  postgres: {
    url: BAT_POSTGRES_URL
  }
})

test.afterEach.always(cleanPgDb(postgres))

test('grants can be inserted into postgres using the `insert` function', async (t) => {
  const client = await postgres.connect()
  let result = null
  let grants = []
  const grant = createGrant()
  grant.createdAt = new Date('2019-01-01')

  result = await client.query(`select * from grants;`)
  grants = result.rows
  t.deepEqual(grants, [], 'no grants yet')

  await insert({
    postgres,
    client,
    grant
  })

  result = await client.query(selectAllGrants)
  grants = result.rows
  t.deepEqual(grants, [grant], 'inserted one grant')
})

test('some data can be assumed when using the `insertGrant` function', async (t) => {
  const client = await postgres.connect()
  let result = null
  let grants = []
  const grant = createGrant()

  result = await client.query(`select * from grants;`)
  grants = result.rows
  t.deepEqual(grants, [], 'no grants')

  await insertGrant({
    postgres,
    client,
    grant
  })

  result = await client.query(selectAllGrants)
  grants = result.rows
  const subGrants = grants.map((grant) => _.omit(grant, ['createdAt']))
  t.deepEqual(subGrants, [grant], 'inserted one grant')
  t.true(grants[0].createdAt instanceof Date, 'createdAt creates a date')
})

test('grant type is constriained', async (t) => {
  const client = await postgres.connect()
  const noTypeGrant = createGrant('not-a-type')
  await t.throwsAsync(() => insertGrant({ postgres, client, grant: noTypeGrant }))
  const autoContGrant = createGrant('auto-contribute')
  await insertGrant({ postgres, client, grant: autoContGrant })
  const oneoffGrant = createGrant('oneoff-tip')
  await insertGrant({ postgres, client, grant: oneoffGrant })
  const recurringGrant = createGrant('recurring-tip')
  await insertGrant({ postgres, client, grant: recurringGrant })
  const { rows } = await client.query(`SELECT * from grants;`)
  t.is(rows.length, 3, '3 rows inserted')
})

test('grant worker takes a list of grants', async (t) => {
  const client = await postgres.connect()
  const grant1 = createGrant()
  const grant2 = createGrant()
  const inputs = [grant1, grant2]
  const grantSuggestionReport = workers['grant-suggestion-report']
  await grantSuggestionReport(debug, { postgres }, inputs)
  const { rows } = await client.query(selectAllGrants)
  const grants = rows.map((grant) => _.omit(grant, ['createdAt']))
  t.deepEqual(grants, inputs, 'a list of grants are inserted')
})

test('grants can be retrieved from endpoint', async (t) => {
  const paymentId = uuidV4()
  const { body } = await eyeshadeAgent
    .get(`/v1/grants/${paymentId}`)
    .send()
    .expect(ok)
  t.deepEqual(body, {
    grants: []
  })
})

function createGrant (type) {
  return {
    type: type || 'auto-contribute',
    cohort: 'ugp',
    amount: '1.000000000000000000',
    channel: braveYoutubePublisher,
    promotionId: uuidV4(),
    id: uuidV4()
  }
}
