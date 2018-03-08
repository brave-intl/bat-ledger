const bson = require('bson')
const underscore = require('underscore')

var exports = {}

exports.workers = {
/* sent by ledger POST /v1/registrar/persona/{personaId}

    { queue               : 'persona-report'
    , message             :
      { paymentId         : '...'
      , provider          : 'bitgo'
      , address           : '...'
      , keychains         :
        { user            : { xpub: '...', encryptedXprv: '...' }
        , backup          : { xpub: '...', encryptedXprv: '...' }
        }

      , addresses         : { BTC: '...', ... ]
      , altcurrency       : 'BAT'
      , httpSigningPubKey :
      }
    }
 */
  'persona-report':
    async (debug, runtime, payload) => {
      const paymentId = payload.paymentId
      const wallets = runtime.database.get('wallets', debug)
      let state

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend({ paymentStamp: 0 }, underscore.omit(payload, [ 'paymentId' ]))
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

/* sent by ledger POST /v1/surveyor/contribution
           ledger PATCH /v1/surveyor/contribution/{surveyorId}
           daily()

    { queue            : 'surveyor-report'
    , message          :
      { surveyorId     : '...'
      , surveyorType   : '...'
      , altcurrency    : '...'
      , probi          : ...
      , votes          : ...
      }
    }
 */
  'surveyor-report':
    async (debug, runtime, payload) => {
      const surveyorId = payload.surveyorId
      const surveyors = runtime.database.get('surveyors', debug)
      let state

      payload.probi = bson.Decimal128.fromString(payload.probi.toString())
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend({ counts: 0 }, underscore.omit(payload, [ 'surveyorId' ]))
      }
      await surveyors.update({ surveyorId: surveyorId }, state, { upsert: true })
    },

/* sent by PUT /v1/wallet/{paymentId}

    { queue              : 'contribution-report'
    , message            :
      { viewingId        : '...'
      , paymentId        : '...'
      , address          : '...'
      , paymentStamp     : ...
      , surveyorId       : '...'
      , altcurrency      : '...'
      , probi            : ...
      , fee              : ...
      , votes            : ...
      , hash             : '...'
      , cohort           : '...'
      }
    }
 */
  'contribution-report':
    async (debug, runtime, payload) => {
      const cohort = payload.cohort
      const paymentId = payload.paymentId
      const viewingId = payload.viewingId
      const contributions = runtime.database.get('contributions', debug)
      const wallets = runtime.database.get('wallets', debug)
      let state

      if (cohort && runtime.config.testingCohorts.includes(cohort)) {
        payload.probi = bson.Decimal128.fromString('0')
      } else {
        payload.probi = bson.Decimal128.fromString(payload.probi.toString())
      }
      payload.fee = bson.Decimal128.fromString(payload.fee.toString())
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(payload, [ 'viewingId' ])
      }
      await contributions.update({ viewingId: viewingId }, state, { upsert: true })

      state.$set = { paymentStamp: payload.paymentStamp }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

/* sent by PUT /v1/surveyor/viewing/{surveyorId}

{ queue           : 'voting-report'
, message         :
  { surveyorId    : '...'
  , publisher     : '...'
  }
}
 */
  'voting-report':
    async (debug, runtime, payload) => {
      const publisher = payload.publisher
      const surveyorId = payload.surveyorId
      const cohort = payload.cohort || 'control'
      const voting = runtime.database.get('voting', debug)
      let state

      if (!publisher) throw new Error('no publisher specified')

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $inc: { counts: 1 },
        $set: { exclude: runtime.config.testingCohorts.includes(cohort) }
      }
      await voting.update({ surveyorId: surveyorId, publisher: publisher, cohort: cohort }, state, { upsert: true })
    },

/* sent when the wallet balance updates

    { queue            : 'wallet-report'
    , message          :
      { paymentId      : '...'
      , balances       : { ... }
      }
    }
 */
  'wallet-report':
    async (debug, runtime, payload) => {
      const paymentId = payload.paymentId
      const wallets = runtime.database.get('wallets', debug)
      let state

      underscore.keys(payload.balances).forEach((key) => {
        payload.balances[key] = bson.Decimal128.fromString(payload.balances[key])
      })
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { balances: payload.balances }
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

/* sent by PUT /v1/grants/{paymentId}

{ queue           : 'grant-report'
, message         :
  { grantId       : '...'
  , promotionId   : '...'
  , altcurrency   : '...'
  , probi         : ...
  , paymentId     : '...'
  }
}
 */
  'grant-report':
    async (debug, runtime, payload) => {
      const grantId = payload.grantId
      const grants = runtime.database.get('grants', debug)
      let state

      payload.probi = bson.Decimal128.fromString(payload.probi)
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(payload, [ 'grantId' ])
      }
      await grants.update({ grantId: grantId }, state, { upsert: true })
    },

/* sent by PUT /v1/wallet/{paymentId} (if one or more grants are redeemed)

{ queue           : 'redeem-report'
, message         :
  { grantIds      : '...'
  , redeemed      : { ... }
  }
}
 */
  'redeem-report':
    async (debug, runtime, payload) => {
      const grantIds = payload.grantIds
      const grants = runtime.database.get('grants', debug)
      let state

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(payload, [ 'grantIds' ])
      }
      await grants.update({ grantId: { $in: grantIds } }, state, { upsert: true })
    }
}

module.exports = exports
