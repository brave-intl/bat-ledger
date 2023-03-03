#!/usr/bin/env node
import Database from 'bat-utils/lib/runtime-database'
import Queue from 'bat-utils/lib/runtime-queue'
import SDebug from 'sdebug'
const debug = new SDebug('migrate-transaction-table')

async function main () {
  const database = new Database({ database: process.env.MONGODB_URI })
  const queue = new Queue({ queue: process.env.REDIS_URL })

  // settlements

  const settlements = database.get('settlements', debug)
  const settlementIds = await settlements.distinct('settlementId')

  for (let i = 0; i < settlementIds.length; i += 1) {
    const settlementId = settlementIds[i]
    if (settlementId) {
      await queue.send(debug, 'settlement-report', { settlementId })
    }
  }

  // referrals

  const referrals = database.get('referrals', debug)
  const transactionIds = await referrals.distinct('transactionId')

  for (let i = 0; i < transactionIds.length; i += 1) {
    const transactionId = transactionIds[i]
    if (transactionId) {
      await queue.send(debug, 'referral-report', { transactionId })
    }
  }

  // contributions

  const surveyorsC = database.get('surveyors', debug)
  const surveyors = await surveyorsC.find({ surveyorType: 'contribution', frozen: true })

  for (let i = 0; i < surveyors.length; i += 1) {
    const surveyor = surveyors[i]
    const { surveyorId } = surveyor
    if (surveyorId) {
      await queue.send(debug, 'surveyor-frozen-report', { surveyorId })
    }
  }

  await database.db.close()
  await queue.rsmq.quit()
}

main().then(result => {}).catch(e => {
  console.error(e)
})
