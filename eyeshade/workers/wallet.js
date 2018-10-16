const bson = require('bson')
const underscore = require('underscore')

exports.name = 'wallet'
exports.initialize = async (debug, runtime) => {
  const voting = runtime.database.get('voting', debug)
  let indices

  try { indices = await voting.indexes() } catch (ex) { indices = [] }
  if (underscore.keys(indices).indexOf('surveyorId_1_publisher_1') !== -1) {
    await voting.dropIndex([ 'surveyorId', 'publisher' ])
  }

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('wallets', debug),
      name: 'wallets',
      property: 'paymentId',
      empty: {
        paymentId: '',
        address: '',
        provider: '',
        balances: {},
        keychains: {},
        paymentStamp: 0,

     // v2 and later
        altcurrency: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { paymentId: 1 } ],
      others: [ { provider: 1 }, { address: 1 }, { altcurrency: 1 }, { paymentStamp: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('surveyors', debug),
      name: 'surveyors',
      property: 'surveyorId',
      empty: {
        surveyorId: '',
        surveyorType: '',
        votes: 0,
        counts: 0,

     // v1 only
     // satoshis: 0,

     // v2 and later
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,

        timestamp: bson.Timestamp.ZERO,
        frozen: false,
        mature: false,
        rejectedVotes: 0,

     // added during report runs...
        inputs: bson.Decimal128.POSITIVE_ZERO,
        fee: bson.Decimal128.POSITIVE_ZERO,
        quantum: 0
      },
      unique: [ { surveyorId: 1 } ],
      others: [ { surveyorType: 1 }, { votes: 1 }, { counts: 1 }, { altcurrency: 1 }, { probi: 1 }, { timestamp: 1 },
                { inputs: 1 }, { fee: 1 }, { quantum: 1 }, { frozen: 1 }, { mature: 1 }, { rejectedVotes: 1 } ]
    },
    {
      category: runtime.database.get('contributions', debug),
      name: 'contributions',
      property: 'viewingId',
      empty: {
        viewingId: '',
        paymentId: '',
        address: '',
        paymentStamp: 0,
        surveyorId: '',
     // v1 only
     // satoshis: 0,

     // v2 and later
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,
        mature: false,

        fee: bson.Decimal128.POSITIVE_ZERO,
        votes: 0,
        hash: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { viewingId: 1 } ],
      others: [ { paymentId: 1 }, { address: 1 }, { paymentStamp: 1 }, { surveyorId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { fee: 1 }, { votes: 1 }, { hash: 1 }, { timestamp: 1 }, { altcurrency: 1, probi: 1, votes: 1 },
                { mature: 1 } ]
    },
    {
      category: voting,
      name: 'voting',
      property: 'surveyorId_1_publisher_1_cohort',
      empty: {
        surveyorId: '',
        publisher: '',
        cohort: '',
        counts: 0,
        timestamp: bson.Timestamp.ZERO,

     // added by administrator
        exclude: false,
        hash: '',

     // added during report runs...
     // v1 only
        satoshis: 0,

     // v2 and later
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO
      },
      unique: [ { surveyorId: 1, publisher: 1, cohort: 1 } ],
      others: [ { counts: 1 }, { timestamp: 1 },
                { exclude: 1 }, { hash: 1 }, { counts: 1 },
                { altcurrency: 1, probi: 1 },
                { altcurrency: 1, exclude: 1, probi: 1 },
                { owner: 1, altcurrency: 1, exclude: 1, probi: 1 },
                { publisher: 1, altcurrency: 1, exclude: 1, probi: 1 } ]
    },
    {
      category: runtime.database.get('grants', debug),
      name: 'grants',
      property: 'grantId',
      empty: {
        grantId: '',

        promotionId: '',
        altcurrency: '',
        probi: '0',

        paymentId: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { grantId: 1 } ],
      others: [ { promotionId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { paymentId: '' },
                { timestamp: 1 } ]
    }
  ])
}

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

      payload.probi = bson.Decimal128.fromString(payload.probi.toString())
      const $set = underscore.extend({
        counts: 0
      }, underscore.omit(payload, [ 'surveyorId' ]))
      const $setOnInsert = {
        mature: false,
        frozen: false,
        rejectedVotes: 0,
        surveyorId
      }
      const state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set,
        $setOnInsert
      }
      await surveyors.update({ surveyorId }, state, { upsert: true })
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
      const { database } = runtime
      const voting = database.get('voting', debug)
      const surveyors = database.get('surveyors', debug)
      let state, where

      if (!publisher) throw new Error('no publisher specified')

      where = {
        surveyorId
      }
      const surveyor = await surveyors.findOne(where)
      if (!surveyor) {
        throw new Error('surveyor does not exist')
      }
      if (surveyor.frozen) {
        state = {
          $inc: { rejectedVotes: 1 }
        }
        await surveyors.update(where, state)
      } else {
        where = {
          surveyorId,
          publisher,
          cohort
        }
        state = {
          $currentDate: { timestamp: { $type: 'timestamp' } },
          $inc: { counts: 1 },
          $set: { exclude: runtime.config.testingCohorts.includes(cohort) }
        }
        await voting.update(where, state, { upsert: true })
      }
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
