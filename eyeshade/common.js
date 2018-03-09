const bson = require('bson')

const braveHapi = require('bat-utils').extras.hapi

const publish = async (debug, runtime, method, owner, publisher, endpoint, payload) => {
  let path, result

  if (!runtime.config.publishers) throw new Error('no configuration for publishers server')

  path = '/api'
  if (owner) {
    path += '/owners/' + encodeURIComponent(owner)
    if (publisher) path += '/channels/' + encodeURIComponent(publisher)
  }
  result = await braveHapi.wreck[method](runtime.config.publishers.url + path + (endpoint || ''), {
    headers: {
      authorization: 'Bearer ' + runtime.config.publishers.access_token,
      'content-type': 'application/json'
    },
    payload: JSON.stringify(payload),
    useProxyP: true
  })
  if (Buffer.isBuffer(result)) result = JSON.parse(result)

  return result
}

exports.initialize = async (debug, runtime) => {
  runtime.common = { publish: publish }

  runtime.database.checkIndices(debug, [
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

        fee: bson.Decimal128.POSITIVE_ZERO,
        votes: 0,
        hash: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { viewingId: 1 } ],
      others: [ { paymentId: 1 }, { address: 1 }, { paymentStamp: 1 }, { surveyorId: 1 }, { altcurrency: 1 }, { probi: 1 },
                { fee: 1 }, { votes: 1 }, { hash: 1 }, { timestamp: 1 }, { altcurrency: 1, probi: 1, votes: 1 } ]
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
    },

    {
      category: runtime.database.get('owners', debug),
      name: 'owners',
      property: 'owner',
      empty: {
        owner: '',              // 'oauth#' + provider + ':' + (profile.id || profile._id)

        providerName: '',
        providerSuffix: '',
        providerValue: '',
        visible: false,

        authorized: false,
        authority: '',
        provider: '',
        altcurrency: '',
        parameters: {},

        info: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { owner: 1 } ],
      others: [ { providerName: 1 }, { providerSuffix: 1 }, { providerValue: 1 }, { visible: 1 },
                { authorized: 1 }, { authority: 1 },
                { provider: 1 }, { altcurrency: 1 },
                { timestamp: 1 } ]
    },

    {
      category: runtime.database.get('publishers', debug),
      name: 'publishers',
      property: 'publisher',
      empty: {
        publisher: '',    // domain OR 'oauth#' + provider + ':' + (profile.id || profile._id)
        authority: '',

     // v1 only
     // authorized: false,
     // address: '',
     // legalFormURL: '',

        verified: false,
        visible: false,

     // v2 and later
        owner: '',

        providerName: '',
        providerSuffix: '',
        providerValue: '',
        authorizerEmail: '',
        authorizerName: '',

        altcurrency: '',

        info: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { publisher: 1 } ],
      others: [ { authority: 1 },
                { owner: 1 },
                { providerName: 1 }, { providerSuffix: 1 }, { providerValue: 1 },
                { authorizerEmail: 1 }, { authorizerName: 1 },
                { altcurrency: 1 },
                { timestamp: 1 } ]
    },

    {
      category: runtime.database.get('publishersV2', debug),
      name: 'publishersV2',
      property: 'publisher',
      empty: { publisher: '', facet: '', exclude: false, tags: [], timestamp: bson.Timestamp.ZERO },
      unique: [ { publisher: 1 } ],
      others: [ { facet: 1 }, { exclude: 1 }, { timestamp: 1 } ]
    },

    {
      category: runtime.database.get('restricted', debug),
      name: 'restricted',
      property: 'publisher',
      empty: { publisher: '', tags: [], timestamp: bson.Timestamp.ZERO },
      unique: [ { publisher: 1 } ],
      others: [ { timestamp: 1 } ]
    },

    {
      category: runtime.database.get('scratchpad', debug),
      name: 'scratchpad',
      property: 'owner',
      empty: {
        owner: ''
      },
      others: [ { owner: 1 } ]
    },

    {
      category: runtime.database.get('settlements', debug),
      name: 'settlements',
      property: 'settlementId_1_publisher',
      empty: {
        settlementId: '',
        publisher: '',
        hash: '',
        address: '',

     // v1 only
     // satoshis: 1

     // v2 and later
        owner: '',
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO,
        currency: '',
        amount: bson.Decimal128.POSITIVE_ZERO,
        commission: bson.Decimal128.POSITIVE_ZERO,    // conversion + network fees (i.e., for settlement)

        fees: bson.Decimal128.POSITIVE_ZERO,          // network fees (i.e., for contribution)
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { settlementId: 1, publisher: 1 }, { hash: 1, publisher: 1 } ],
      others: [ { address: 1 },
                { owner: 1 }, { altcurrency: 1 }, { probi: 1 }, { currency: 1 }, { amount: 1 }, { commission: 1 },
                { fees: 1 }, { timestamp: 1 } ]
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

     // added during report runs...
        inputs: bson.Decimal128.POSITIVE_ZERO,
        fee: bson.Decimal128.POSITIVE_ZERO,
        quantum: 0
      },
      unique: [ { surveyorId: 1 } ],
      others: [ { surveyorType: 1 }, { votes: 1 }, { counts: 1 }, { altcurrency: 1 }, { probi: 1 }, { timestamp: 1 },
                { inputs: 1 }, { fee: 1 }, { quantum: 1 } ]
    },

    {
      category: runtime.database.get('tokens', debug),
      name: 'tokens',
      property: 'verificationId_1_publisher',
      empty: {
        verificationId: '',
        publisher: '',
        token: '',
        verified: false,
        authority: '',

     // v2 and later
        owner: '',
        ownerEmail: '',
        ownerName: '',
        visible: false,
        info: {},
        method: '',

        reason: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { verificationId: 1, publisher: 1 } ],
      others: [ { verificationId: 1 }, { publisher: 1 }, { token: 1 }, { verified: 1 }, { authority: 1 },
                { owner: 1 }, { visible: 1 }, { method: 1 },
                { reason: 1 }, { timestamp: 1 } ]
    },

    {
      category: runtime.database.get('voting', debug),
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
                { exclude: 1 }, { hash: 1 },
                { exclude: 1 }, { counts: 1 },
                { altcurrency: 1, probi: 1 },
                { altcurrency: 1, exclude: 1, probi: 1 },
                { owner: 1, altcurrency: 1, exclude: 1, probi: 1 },
                { publisher: 1, altcurrency: 1, exclude: 1, probi: 1 } ]
    },

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
    }
  ])

  await runtime.queue.create('publisher-report')
  await runtime.queue.create('publishers-bulk-create')
  await runtime.queue.create('report-grants-outstanding')
  await runtime.queue.create('report-publishers-contributions')
  await runtime.queue.create('report-publishers-settlements')
  await runtime.queue.create('report-publishers-statements')
  await runtime.queue.create('report-publishers-status')
  await runtime.queue.create('report-surveyors-contributions')
}
