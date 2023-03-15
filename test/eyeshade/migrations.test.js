'use strict'

import test from 'ava'
import Postgres from 'bat-utils/lib/runtime-postgres.js'
import { v4 as uuidV4 } from 'uuid'
import { getCurrent } from '../../eyeshade/migrations/current.js'

const postgres = new Postgres({ postgres: { connectionString: process.env.BAT_POSTGRES_URL } })

test('migrations table is up-to-date', async t => {
  const latestInMigrationsTable = (await postgres.query('select id from migrations order by id desc limit 1;', [])).rows[0].id
  const latestInMigrationsFolder = getCurrent()

  t.true(latestInMigrationsTable === latestInMigrationsFolder)
})

const createPayoutReportQuery = `
insert into payout_reports_ads (id)
values ($1);
`
const createPotentialPaymentsQuery = `
insert into potential_payments_ads (payout_report_id, payment_id, provider_id, amount)
values ($1, $2, $3, $4);
`
test('removal of payout_report_id removes payout_reports_ads as well', async (t) => {
  let q
  const id = uuidV4()
  await postgres.query(createPayoutReportQuery, [id])
  await postgres.query(createPotentialPaymentsQuery, [id, uuidV4(), uuidV4(), '5'])
  q = await postgres.query('SELECT * FROM potential_payments_ads WHERE payout_report_id = $1;', [id])
  t.is(q.rowCount, 1, 'found by payout_reports_ads id')
  await postgres.query('DELETE FROM payout_reports_ads WHERE id = $1;', [id])
  q = await postgres.query('SELECT * FROM potential_payments_ads WHERE payout_report_id = $1;', [id])
  t.is(q.rowCount, 0, 'removal of potential_payments_ads when corresponding payout_reports_ads is deleted')
})
