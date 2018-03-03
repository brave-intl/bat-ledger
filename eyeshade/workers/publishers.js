const json2csv = require('json2csv')
const underscore = require('underscore')

const utils = require('bat-utils').extras.utils
const utf8ify = utils.utf8ify
const timeout = utils.timeout

var exports = {}

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
          result = await runtime.common.publish(debug, runtime, 'post', '', '', '', {
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

      file = await runtime.database.createFile(runtime, 'publishers-', payload)
      if (format === 'json') {
        await file.write(utf8ify(publishers), true)
      } else {
        try { await file.write(utf8ify(json2csv({ data: publishers })), true) } catch (ex) {
          debug('reports', { report: 'bulk-publishers-create', reason: ex.toString() })
          file.close()
        }
      }
      runtime.notify(debug, { channel: '#publishers-bot', text: authority + ' publishers-bulk-create completed' })
    }
}

module.exports = exports
