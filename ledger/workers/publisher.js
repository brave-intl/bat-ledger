const tldjs = require('tldjs')
const underscore = require('underscore')

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
      const publishers = runtime.database.get('publishersX', debug)
      const tld = tldjs.getPublicSuffix(publisher)
      let entry, previous, props, state

      props = underscore.extend({ tld: tld }, underscore.omit(payload, [ 'publisher' ]))

      entry = await publishers.findOne({ publisher: publisher })
      if (entry) {
        previous = underscore.pick(entry, [ 'tld', 'owner', 'verified', 'visible' ])
        if (underscore.isEqual(previous, props)) return
      }

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: props
      }
      await publishers.update({ publisher: publisher }, state, { upsert: true })
    }
}
