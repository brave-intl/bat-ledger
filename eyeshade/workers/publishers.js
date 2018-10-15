const { insertFromSettlement, updateBalances } = require('../lib/transaction.js')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('settlement-report')
}

exports.workers = {
/* sent by POST /v1/publishers/settlement

    { queue            : 'settlement-report'
    , message          :
      { settlementId   : '...', shouldUpdateBalances: false }
    }
*/
  'settlement-report':
    async (debug, runtime, payload) => {
      const settlements = runtime.database.get('settlements', debug)
      const { settlementId, shouldUpdateBalances } = payload
      const docs = await settlements.find({ settlementId, owner: { $exists: true } })

      const client = await runtime.postgres.connect()
      try {
        await client.query('BEGIN')
        try {
          for (let doc of docs) {
            await insertFromSettlement(runtime, client, doc)
          }
        } catch (e) {
          await client.query('ROLLBACK')
          runtime.captureException(e, { extra: { report: 'settlement-report', settlementId } })
          throw e
        }

        if (shouldUpdateBalances) {
          await updateBalances(runtime, client)
        }
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
}
