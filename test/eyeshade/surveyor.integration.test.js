import {
  serial as test
} from 'ava'
import Currency from 'bat-utils/lib/runtime-currency'
import Database from 'bat-utils/lib/runtime-database'
import Postgres from 'bat-utils/lib/runtime-postgres'
import BigNumber from 'bignumber.js'
import {
  workers
} from '../../eyeshade/workers/wallet'
import {
  connectToDb,
  createSurveyor,
  dbUri,
  cleanDbs,
  cleanPgDb,
  debug,
  getSurveyor
} from '../utils'
import {
  timeout
} from 'bat-utils/lib/extras-utils'

const votingReportWorker = workers['voting-report']

process.env.SERVICE = 'ledger'
const config = require('../../config')
const mongo = dbUri('eyeshade')
const database = new Database({
  database: {
    mongo
  }
})
const currency = new Currency(config)
const postgres = new Postgres({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})

const runtime = {
  database,
  config,
  currency,
  postgres,
  captureExcaption: (e) => console.log(e)
}

test.after(cleanDbs)
test.after(cleanPgDb(postgres))

test('voting report adds votes', async (t) => {
  let body
  let rows
  const eyeshade = await connectToDb('eyeshade')
  const surveyors = eyeshade.collection('surveyors')
  const publisher = 'fake-publisher'

  await createSurveyor()
  ;({ body } = await getSurveyor())
  const { surveyorId } = body
  await waitUntilPropagated(querySurveyor)
  rows = await countVotes()
  t.deepEqual(rows, [])
  await votingReportWorker(debug, runtime, {
    surveyorId,
    publisher
  })
  rows = await countVotes()
  t.is(rows.length, 1)
  const [row] = rows
  t.deepEqual({
    to_account: row.to_account,
    publisher: row.channel,
    amount: new BigNumber(row.amount).toString()
  }, {
    publisher,
    to_account: publisher,
    amount: new BigNumber('1').toString()
  })

  async function countVotes () {
    const {
      rows
    } = await runtime.postgres.query(`
 SELECT * from transactions
 WHERE document_id = $1::text
 AND to_account = $2::text;`, [surveyorId, publisher])
    return rows
  }

  function querySurveyor () {
    return surveyors.findOne({
      surveyorId
    })
  }

  async function waitUntilPropagated (fn) {
    let finished
    do {
      await timeout()
      finished = await fn()
    } while (!finished)
  }
})
