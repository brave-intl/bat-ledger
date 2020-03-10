const {
  insertFromSettlement,
  updateBalances
} = require('../lib/transaction.js')
const underscore = require('underscore')

exports.name = 'publishers'
exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('settlement-report')
}

exports.workers = {
/* sent by POST /v2/publishers/settlement

    { queue   : 'settlement-report'
    , message :
      { shouldUpdateBalances : false,
        settlementId         : '',
        publisher            : '',
        type                 : '',
      }
    }
*/
  'settlement-report':
    async (debug, runtime, payload) => {
      const settlementsCollection = runtime.database.get('settlements', debug)
      const {
        shouldUpdateBalances,
        settlementId,
        publisher,
        type
      } = payload

      const query = {
        type,
        settlementId,
        owner: {
          $exists: true
        }
      }

      if (publisher) {
        underscore.extend(query, { publisher })
      }

      const docs = await settlementsCollection.find(query)

      const client = await runtime.postgres.connect()
      try {
        await client.query('BEGIN')
        try {
          for (const doc of docs) {
            await insertFromSettlement(runtime, client, doc)
          }
        } catch (e) {
          await client.query('ROLLBACK')
          runtime.captureException(e, { extra: { report: 'settlement-report', settlementId } })
          throw e
        }
        await client.query('COMMIT')
        if (shouldUpdateBalances) {
          await updateBalances(runtime)
        }
      } finally {
        client.release()
      }
    }
}
