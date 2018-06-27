const json2csv = require('json2csv')
const underscore = require('underscore')

const reports = require('./reports.js')
const create = reports.create
const publish = reports.publish
const utils = require('bat-utils').extras.utils
const utf8ify = utils.utf8ify
const timeout = utils.timeout
const { insertFromSettlement, updateBalances } = require('../lib/transaction.js')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('publisher-report')
  await runtime.queue.create('publishers-bulk-create')
  await runtime.queue.create('settlement-report')
}

exports.workers = {
/* sent by POST /v1/publishers

    { queue            : 'publishers-bulk-create'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      , publishers     :
        [ { publisher  : '...'
          , name       : '...'
          , phone      : '...'
          , show_verification_status
                       : true | false
          }
          ...
        ]
      }
    }
 */
  'publishers-bulk-create':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const publishers = payload.publishers
      const publishersC = runtime.database.get('publishers', debug)
      let file, result, state, visible

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { verified: true, reason: 'bulk loaded', authority: authority }
      }
      for (let entry of publishers) {
        visible = entry.show_verification_status
        try {
          result = await publish(debug, runtime, 'post', '', '', '', {
            publisher: underscore.extend({ brave_publisher_id: entry.publisher, verified: true },
                                         underscore.omit(entry, [ 'publisher' ]))
          })

          state.$set.visible = visible
          await publishersC.update({ publisher: entry.publisher }, state, { upsert: true })

          entry.message = result && result.message

          if (entry.message === 'success') {
            await runtime.queue.send(debug, 'publisher-report',
                                     { owner: entry.owner, publisher: entry.publisher, verified: true, visible: visible })
          }
        } catch (ex) {
          entry.message = ex.toString()
        }
        await timeout(250)
      }

      file = await create(runtime, 'publishers-', payload)
      if (format === 'json') {
        await file.write(utf8ify(publishers), true)
      } else {
        try { await file.write(utf8ify(json2csv({ data: publishers })), true) } catch (ex) {
          debug('reports', { report: 'bulk-publishers-create', reason: ex.toString() })
          file.close()
        }
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' publishers-bulk-create completed' })
    },
/* sent by POST /v1/publishers/settlement

    { queue            : 'settlement-report'
    , message          :
      { settlementId   : '...' }
    }
*/
  'settlement-report':
    async (debug, runtime, payload) => {
      const settlements = runtime.database.get('settlements', debug)
      const { settlementId } = payload
      const docs = await settlements.find({ settlementId, owner: { $exists: true } })

      const client = await runtime.postgres.pool.connect()
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

        await updateBalances(runtime, client)
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
}
