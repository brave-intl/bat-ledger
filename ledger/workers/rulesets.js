const dateformat = require('dateformat')
const json2csv = require('json2csv')
const underscore = require('underscore')

const datefmt2 = 'yyyymmdd-HHMMss-l'

const create = async (runtime, prefix, params) => {
  let extension, filename, options

  if (params.format === 'json') {
    options = { content_type: 'application/json' }
    extension = '.json'
  } else {
    options = { content_type: 'text/csv' }
    extension = '.csv'
  }
  filename = prefix + dateformat(underscore.now(), datefmt2) + extension
  options.metadata = { 'content-disposition': 'attachment; filename="' + filename + '"' }
  return runtime.database.file(params.reportId, 'w', options)
}

var exports = {}

exports.workers = {
/* retrieve the entire ruleset

    { queue            : 'patch-publisher-rulesets'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , format         : 'json' | 'csv'
      }
    }
 */
  'patch-publisher-rulesets':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const entries = payload.entries
      const publishers = runtime.database.get('publishersV2', debug)
      let data, entry, file, i, result, state

      data = []
      for (i = 0; i < entries.length; i++) {
        entry = entries[i]
        if ((entry.facet !== 'domain') || (entry.exclude !== true)) {
          data.push({ publisher: entry.publisher, message: 'invalid entry' })
          continue
        }

        result = await publishers.findOne({ publisher: entry.publisher, facet: 'domain' })
        if (result) {
          data.push({ publisher: entry.publisher, message: 'domain already exists' })
          continue
        }

        result = await publishers.findOne({ publisher: entry.publisher.split('.')[0], facet: 'SLD' })
        if (result) {
          data.push({ publisher: entry.publisher, message: 'SLD already exists' })
          continue
        }

        state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: underscore.omit(entry, 'publisher') }
        await publishers.update({ publisher: entry.publisher }, state, { upsert: true })

        data.push({ publisher: entry.publisher, message: '' })
      }

      file = await create(runtime, 'publisher-rulesets-', payload)
      try { await file.write(json2csv({ data: data }), true) } catch (ex) {
        debug('reports', { report: 'patch-publisher-rulesets', reason: ex.toString() })
        file.close()
      }
      return runtime.notify(debug, { channel: '#ledger-bot', text: authority + ' patch-publisher-rulesets completed' })
    },

/* retrieve the entire ruleset

    { queue            : 'report-publisher-rulesets'
    , message          :
      { reportId       : '...'
      , reportURL      : '...'
      , authority      : '...:...'
      , exclude        : true | false
      , facet          : '...'
      , tag            : '...'
      , format         : 'json' | 'csv'
      }
    }
 */
  'report-publisher-rulesets':
    async (debug, runtime, payload) => {
      const authority = payload.authority
      const format = payload.format || 'csv'
      const tag = payload.tag
      const publishers = runtime.database.get('publishersV2', debug)
      let data, entries, file, query

      query = underscore.pick(payload, [ 'exclude', 'facet' ])
      if (tag) query.tags = { $in: [ tag ] }
      entries = await publishers.find(query)
      data = []
      entries.forEach(entry => {
        if (entry.publisher === '') return

        data.push(underscore.extend(underscore.omit(entry, [ '_id', 'timestamp' ]),
                                    { timestamp: entry.timestamp.toString() }))
      })

      file = await create(runtime, 'publisher-rulesets-', payload)
      if (format === 'json') {
        await file.write(JSON.stringify(data, null, 2), true)
        return runtime.notify(debug, { channel: '#ledger-bot', text: authority + ' report-publisher-rulesets completed' })
      }

      try { await file.write(json2csv({ data: data }), true) } catch (ex) {
        debug('reports', { report: 'report-publisher-rulesets', reason: ex.toString() })
        file.close()
      }
      runtime.notify(debug, { channel: '#ledger-bot', text: authority + ' report-publisher-rulesets completed' })
    }
}

module.exports = exports
