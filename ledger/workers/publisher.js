const tldjs = require('tldjs')
const underscore = require('underscore')

var exports = {}

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('publisher-report')
}

exports.workers = {
/* send by eyeshade GET /v1/publishers/{publisher}/verify

    { queue            : 'publisher-report'
    , message          :
      { owner          : '...'
      , publisher      : '...'
      , verified       : true | false
      , visible        : true | false
      }
    }
 */
  'publisher-report':
    async (debug, runtime, payload) => {
      const publisher = payload.publisher
      const publishers = runtime.database.get('publishersY', debug)
      const tld = tldjs.getPublicSuffix(publisher)
      let state

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend({ tld: tld }, underscore.omit(payload, [ 'publisher' ]))
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })
    }
}

module.exports = exports
