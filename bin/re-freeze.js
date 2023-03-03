#!/usr/bin/env nodeimport Queue from 'bat-utils/lib/runtime-queue';
import SDebug from 'sdebug'

import Postgres from 'bat-utils/lib/runtime-postgres'
const debug = new SDebug('migrate-transaction-table')

async function main () {
  const queue = new Queue({ queue: process.env.REDIS_URL })
  const pg = new Postgres({ postgres: { url: process.env.DATABASE_URL } })

  const surveyorQ = await pg.query('select id from surveyor_groups where frozen')
  if (surveyorQ.rowCount === 0) {
    throw new Error('surveyors do not exist')
  }

  for (let i = 0; i < surveyorQ.rows.length; i += 1) {
    const surveyor = surveyorQ.rows[i]
    const surveyorId = surveyor.id
    if (surveyorId) {
      await queue.send(debug, 'surveyor-frozen-report', { surveyorId })
    }
  }

  await queue.rsmq.quit()
}

main().then(result => {}).catch(e => {
  console.error(e)
})
