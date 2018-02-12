const bson = require('bson')

const braveHapi = require('bat-utils').extras.hapi

const publish = async (debug, runtime, method, owner, publisher, endpoint, payload) => {
  let path, result

  if (!runtime.config.publishers) throw new Error('no configuration for publishers server')

  path = '/api/'
  if (owner) path += 'owners/' + encodeURIComponent(owner) + '/'
  path += 'publishers/' + encodeURIComponent(publisher)
  result = await braveHapi.wreck[method](runtime.config.publishers.url + path, endpoint, {
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
     // verified: false,
     // address: '',
     // legalFormURL: '',

     // OBE
     // visible: false,

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
      others: [ { token: 1 }, { verified: 1 }, { authority: 1 },
                { owner: 1 }, { visible: 1 }, { method: 1 },
                { reason: 1 }, { timestamp: 1 } ]
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
