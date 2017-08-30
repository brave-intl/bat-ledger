const bson = require('bson')
const underscore = require('underscore')

var exports = {}

exports.initialize = async (debug, runtime) => {
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
        probi: 0,

        timestamp: bson.Timestamp.ZERO,

     // added during report runs...
        inputs: 0,
        fee: 0,
        quantum: 0
      },
      unique: [ { surveyorId: 1 } ],
      others: [ { surveyorType: 1 }, { votes: 1 }, { counts: 1 }, { altcurrency: 1 }, { probi: 1 }, { timestamp: 1 },
                { inputs: 1 }, { fee: 1 }, { quantum: 1 } ]
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
        probi: 0,

        fee: 0,
        votes: 0,
        hash: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { viewingId: 1 } ],
      others: [ { paymentId: 1 }, { address: 1 }, { paymentStamp: 1 }, { surveyorId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { fee: 1 }, { votes: 1 }, { hash: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('voting', debug),
      name: 'voting',
      property: 'surveyorId_1_publisher',
      empty: {
        surveyorId: '',
        publisher: '',
        counts: 0,
        timestamp: bson.Timestamp.ZERO,

     // added by administrator
        exclude: false,
        hash: '',

     // added during report runs...
     // v1 only
        satoshis: '',

     // v2 and later
        altcurrency: '',
        probi: 0
      },
      unique: [ { surveyorId: 1, publisher: 1 } ],
      others: [ { counts: 1 }, { timestamp: 1 },
                { exclude: 1 }, { hash: 1 },
                { altcurrency: 1, probi: 1 } ]
    }
  ])

  await convertDB(debug, runtime)
}

// TEMPORARY
const convertDB = async (debug, runtime) => {
  const contributions = runtime.database.get('contributions', debug)
  const publishers = runtime.database.get('publishers', debug)
  const settlements = runtime.database.get('settlements', debug)
  const surveyors = runtime.database.get('surveyors', debug)
  const voting = runtime.database.get('voting', debug)
  const wallets = runtime.database.get('wallets', debug)
  let entries

  entries = await wallets.find({ satoshis: { altcurrency: false } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC' }
    }

    await wallets.update({ paymentId: entry.paymentId }, state, { upsert: true })
  })

  entries = await surveyors.find({ satoshis: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC', probi: entry.satoshis },
      $unset: { satoshis: '' }
    }

    await surveyors.update({ surveyorId: entry.surveyorId }, state, { upsert: true })
  })

  entries = await contributions.find({ satoshis: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC', probi: entry.satoshis },
      $unset: { satoshis: '' }
    }

    await contributions.update({ viewingId: entry.viewingId }, state, { upsert: true })
  })

  entries = await voting.find({ satoshis: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC', probi: entry.satoshis },
      $unset: { satoshis: '' }
    }

    await voting.update(underscore.pick(entry, [ 'surveyorId', 'publisher' ]), state, { upsert: true })
  })

  entries = await publishers.find({ legalFormURL: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { provider: '', altcurrency: 'BTC' },
      $unset: { legalFormURL: '' }
    }

    await publishers.update({ publisher: entry.publisher }, state, { upsert: true })
  })

  entries = await settlements.find({ satoshis: { $exists: true } })
  entries.forEach(async (entry) => {
    let state

    state = {
      $set: { altcurrency: 'BTC', probi: entry.satoshis },
      $unset: { satoshis: '' }
    }

    await settlements.update(underscore.pick(entry, [ 'settlementId', 'publisher', 'hash' ]), state, { upsert: true })
  })
}

exports.workers = {
/* sent by ledger POST /v1/registrar/persona/{personaId}

    { queue            : 'persona-report'
    , message          :
      { paymentId      : '...'
      , provider       : 'bitgo'
      , address        : '...'
      , altcurrency    : 'BTC'
      , keychains      :
        { user         : { xpub: '...', encryptedXprv: '...' }
        , backup       : { xpub: '...', encryptedXprv: '...' }
        }
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

      if (typeof payload.probi === 'undefined') {
        payload = underscore.omit(underscore.extend(payload, { altcurrency: 'BTC', probi: payload.satoshis }), [ 'satoshis' ])
      }
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
      }
    }
 */
  'contribution-report':
    async (debug, runtime, payload) => {
      const paymentId = payload.paymentId
      const viewingId = payload.viewingId
      const contributions = runtime.database.get('contributions', debug)
      const wallets = runtime.database.get('wallets', debug)
      let state

      if (typeof payload.probi === 'undefined') {
        payload = underscore.omit(underscore.extend(payload, { altcurrency: 'BTC', probi: payload.satoshis }), [ 'satoshis' ])
      }
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
      const voting = runtime.database.get('voting', debug)
      let state

      if (!publisher) throw new Error('no publisher specified')

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $inc: { counts: 1 },
        $set: { exclude: false }
      }
      await voting.update({ surveyorId: surveyorId, publisher: publisher }, state, { upsert: true })
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

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { balances: payload.balances }
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    }
}

module.exports = exports
