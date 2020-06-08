const {
  insertFromSettlement
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
      { settlementId         : '',
        publisher            : '',
        type                 : '',
      }
    }
*/
  'settlement-report':
    async (debug, runtime, payload) => {
      const settlementsCollection = runtime.database.get('settlements', debug)
      const {
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
          for (let i = 0; i < docs.length; i += 1) {
            await insertFromSettlement(runtime, client, docs[i])
          }
        } catch (e) {
          await client.query('ROLLBACK')
          runtime.captureException(e, { extra: { report: 'settlement-report', settlementId } })
          throw e
        }
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
}
