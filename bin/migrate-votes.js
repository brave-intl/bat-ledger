#!/usr/bin/env node

import Database from 'bat-utils/lib/runtime-database'
import SDebug from 'sdebug'
import { v5 as uuidv5 } from 'uuid'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { createdTimestamp, BigNumber, normalizeChannel } from 'bat-utils/lib/extras-utils.js'
const debug = new SDebug('migrate-transaction-table')

async function consume (pg, votings) {
  return Promise.all(votings.map(async (voting) => {
    const { publisher, cohort } = voting
    if (publisher && cohort) {
      const normalizedChannel = normalizeChannel(voting.publisher)
      const created = createdTimestamp(voting._id)

      const probi = voting.probi && new BigNumber(voting.probi.toString())
      const fees = voting.probi && new BigNumber(voting.fees.toString())

      await pg.query('insert into votes (id, created_at, updated_at, cohort, amount, fees, tally, excluded, transacted, channel, surveyor_id) values ($1, to_timestamp($2), to_timestamp($3), $4, $5, $6, $7, $8, $9, $10, $11)', [
        // channel, cohort and surveyor group id should be unique per
        uuidv5(normalizedChannel + voting.cohort + voting.surveyorId, 'f0ca8ff9-8399-493a-b2c2-6d4a49e5223a'),
        created / 1000,
        voting.timestamp.high_,
        voting.cohort,
        (probi && probi.dividedBy('1e18').toString()) || null,
        (fees && fees.dividedBy('1e18').toString()) || null,
        voting.counts,
        voting.exclude,
        false,
        normalizedChannel,
        voting.surveyorId
      ])
    } else {
      throw new Error('nani')
    }
  }))
}

async function main () {
  const database = new Database({ database: process.env.MONGODB_URI })
  // process.env.NODE_ENV = 'production'
  const pg = new Postgres({ postgres: { url: process.env.DATABASE_URL } })

  const votingC = database.get('voting', debug)
  const surveyorC = database.get('surveyors', debug)
  const surveyors = await surveyorC.find()

  for (let i = 0; i < surveyors.length; i += 1) {
    const surveyor = surveyors[i]
    const { surveyorId } = surveyor
    const created = createdTimestamp(surveyor._id)

    const probi = surveyor.probi && new BigNumber(surveyor.probi.toString())
    const price = probi.dividedBy('1e18').dividedBy(surveyor.votes)

    await pg.query('insert into surveyor_groups (id, created_at, updated_at, price, ballots, frozen) values ($1, to_timestamp($2), to_timestamp($3), $4, $5, $6)', [
      surveyorId,
      created / 1000,
      surveyor.timestamp.high_,
      price.toString(),
      surveyor.counts,
      surveyor.frozen || false
    ])

    console.log('fetching surveyor: ' + surveyorId)
    const votings = await votingC.find({ surveyorId })
    await consume(pg, votings)
  }

  const surveyorIds = surveyors.map((surveyor) => surveyor.surveyorId)
  const votings = await votingC.find({ surveyorId: { $nin: surveyorIds } })
  await consume(pg, votings)

  const backfillTransacted = `
update votes
  set transacted = true
from
(select votes.id
  from votes join transactions
  on (transactions.document_id = votes.surveyor_id and transactions.to_account = votes.channel)
  where not votes.excluded
) o
where votes.id = o.id
;
 `

  await pg.pool().query(backfillTransacted, [])

  await database.db.close()
}

main().then(result => {}).catch(e => {
  console.error(e)
})
