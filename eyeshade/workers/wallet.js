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
        satoshis: 0,

     // v2 and later
        altcurrency: '',
        probi: bson.Decimal128.POSITIVE_ZERO
      },
      unique: [ { surveyorId: 1, publisher: 1 } ],
      others: [ { counts: 1 }, { timestamp: 1 },
                { exclude: 1 }, { hash: 1 },
                { altcurrency: 1, probi: 1 } ]
    }
  ])

/* one-time fixup */
  let viewings = [
    { 'viewingId': '3c0058a3-cb3c-4a79-9577-d14b9deb321b', 'count': 50 },
    { 'viewingId': '0ec4f7bb-3249-43d1-8690-90ff1d3c89fd', 'count': 63 },
    { 'viewingId': '4acfc05a-a019-4093-8644-a29d89b8c9f5', 'count': 63 },
    { 'viewingId': 'e5945472-1afb-4031-9760-4f1bc2e2a36e', 'count': 63 },
    { 'viewingId': '7b939930-f713-4307-b82b-77b0566ee826', 'count': 63 },
    { 'viewingId': 'cef34bea-dc61-4d27-a49e-a68c8b0576e6', 'count': 38 },
    { 'viewingId': '6a0af783-a624-40d1-8354-e414b4e7beb9', 'count': 63 },
    { 'viewingId': '0a4d088e-9734-4c70-a0f3-72898feddab0', 'count': 63 },
    { 'viewingId': 'f7718396-cd38-4e58-b5f4-e76ac92b8fcb', 'count': 63 },
    { 'viewingId': '70bbc0c9-aaa1-48a1-8bd7-36ef8eb3e75c', 'count': 38 },
    { 'viewingId': '858c770e-75a0-44e8-adc3-41c6ae32b081', 'count': 63 },
    { 'viewingId': 'c29a7a0b-e6b8-4170-a0da-547616da4456', 'count': 63 },
    { 'viewingId': '87c61015-26a5-4782-be38-34c625db9656', 'count': 63 },
    { 'viewingId': '64c48c29-474f-4604-8d84-c1b291be20e2', 'count': 63 },
    { 'viewingId': 'da50f2d6-5085-4445-b5e0-63989e9d3c99', 'count': 13 },
    { 'viewingId': '19de17b8-00e3-46fa-813b-276c60c6e8a5', 'count': 63 },
    { 'viewingId': '183dc8ec-bc82-4a00-9f6e-be70dafaca52', 'count': 60 },
    { 'viewingId': 'f3ee858d-830c-407a-89a8-ee8a834c1759', 'count': 63 },
    { 'viewingId': '1b1bcba5-de94-40d1-a8e7-7323ca8bf1d6', 'count': 63 },
    { 'viewingId': 'f2990a0e-83c7-41db-bc7f-944faf6479b4', 'count': 47 },
    { 'viewingId': 'a250cd6c-3537-4b3a-a8d0-cad283e73de9', 'count': 19 },
    { 'viewingId': '78f7fab5-e652-426f-ba59-b3ce2bed7ac3', 'count': 47 },
    { 'viewingId': 'af6c7570-efa7-4bf6-87e5-61a74265c734', 'count': 46 },
    { 'viewingId': 'efb38e4b-6cb0-40de-91cd-21ecafe29c56', 'count': 46 },
    { 'viewingId': '8441b84f-7115-4e96-b600-eeabb8f43071', 'count': 47 },
    { 'viewingId': '456af896-1105-4451-ae2b-aeda5f374f51', 'count': 46 },
    { 'viewingId': 'e3121cb5-b93c-45cf-b743-602efce7473e', 'count': 46 },
    { 'viewingId': '237fb626-b1f7-4a4c-af1b-1bf37a3ade7c', 'count': 9 },
    { 'viewingId': '5ce6b328-e3aa-45ec-a257-4422c23a0354', 'count': 46 },
    { 'viewingId': '015ba815-edf2-4067-b396-467f1c43f762', 'count': 46 },
    { 'viewingId': 'df2c8f23-f691-493b-80a6-696eca35a6c1', 'count': 46 },
    { 'viewingId': '0713bfdc-f32b-4eb1-815a-4d343c46e5d3', 'count': 46 },
    { 'viewingId': '5f46ba69-8966-4cd0-b077-33d1ec2ac154', 'count': 9 },
    { 'viewingId': '91329b92-d960-44a8-a3e0-df60e50b5f23', 'count': 37 },
    { 'viewingId': 'a4b6ccc5-27c1-44e7-8144-87acac8a40e3', 'count': 46 },
    { 'viewingId': 'b33761b2-1c82-4930-9707-4c9c93060cb3', 'count': 46 },
    { 'viewingId': 'c7e9b44c-0fe4-4dfe-aa2a-760fa6294163', 'count': 46 },
    { 'viewingId': '8e82c1f1-da86-4e80-9d3f-d83cf8e5633b', 'count': 46 },
    { 'viewingId': 'd66bdb0c-ffc6-47ed-a06c-08d5bb069125', 'count': 46 },
    { 'viewingId': 'd8e29a56-d9c6-4ede-aa70-b9c933daf893', 'count': 60 },
    { 'viewingId': '3e3770a1-e7a2-4c00-a284-a0697c41e5c8', 'count': 92 },
    { 'viewingId': '1824e174-0e5b-403c-ab25-0cedae5e968b', 'count': 28 },
    { 'viewingId': 'e0f68b2c-06c7-4fb1-a12e-253f42dbd0d8', 'count': 46 },
    { 'viewingId': 'aea214c0-e45c-478e-b6c9-7ce4f3bb589a', 'count': 63 },
    { 'viewingId': '86bc2d4f-b033-4c51-a680-ecf2d4a32bd8', 'count': 63 },
    { 'viewingId': '1106d5b8-f8df-4c4c-b026-f17a406acfb2', 'count': 46 },
    { 'viewingId': 'bb30c231-b03c-4009-85e7-58cf649cc4a1', 'count': 92 },
    { 'viewingId': '8c92d02d-f782-4e00-80cc-cdd14daedce7', 'count': 46 },
    { 'viewingId': '742afab0-c821-4cc6-a607-7ceefbf1e0aa', 'count': 46 },
    { 'viewingId': 'f719b860-1ddf-4661-ac15-83e19173640b', 'count': 46 },
    { 'viewingId': '79cdaf7b-b31d-410a-81f5-26780221126f', 'count': 46 },
    { 'viewingId': 'cb549d57-9854-409b-84ef-44df39880a2c', 'count': 46 },
    { 'viewingId': '858c0902-b791-4f48-80c7-c15ae95d1426', 'count': 9 },
    { 'viewingId': '8ae8447a-d8a8-4ae2-8e9c-af552fd76a0b', 'count': 92 },
    { 'viewingId': '79936d03-6fff-4393-8e23-4f6a216696b2', 'count': 184 },
    { 'viewingId': '41a38782-d31e-4ec4-bdb7-572471d49c9d', 'count': 46 },
    { 'viewingId': '4628d76c-2811-4301-acb1-d508e5ee9f06', 'count': 45 },
    { 'viewingId': '4116c661-599a-42d6-9997-4d94ee942c3d', 'count': 46 },
    { 'viewingId': '2429483c-62b9-49d7-822c-f6ab60282405', 'count': 46 },
    { 'viewingId': '73550403-5637-4d4d-837b-74c3c0cdf338', 'count': 46 },
    { 'viewingId': 'd5f90df6-d284-4a49-a847-b1ebf7d6682f', 'count': 46 },
    { 'viewingId': '7b695946-fd81-4d6f-8f17-19d2f2b961cd', 'count': 46 },
    { 'viewingId': '7656b0e3-ef8c-4d06-bfee-fd12157b9db0', 'count': 46 },
    { 'viewingId': '7133d90a-591a-4b71-b315-a2ea921af8bb', 'count': 46 },
    { 'viewingId': 'bfa3d241-4a61-42e8-a1cf-403caf13c450', 'count': 63 },
    { 'viewingId': '47fe7a97-ea8b-4523-9baf-385ab149222a', 'count': 46 },
    { 'viewingId': '47a8edd9-4a20-4680-bd59-799eebd32f81', 'count': 63 },
    { 'viewingId': 'd9c58f81-4e3a-47c6-9886-8932895f4985', 'count': 46 },
    { 'viewingId': 'c6646745-2d7b-46c7-b29f-af5026a56ece', 'count': 46 },
    { 'viewingId': 'ec3e1560-87c2-42fd-b93e-ae2af37aa523', 'count': 46 },
    { 'viewingId': 'e986bd75-0bb0-4f27-8b36-f41b2a269da9', 'count': 46 },
    { 'viewingId': 'bc1dd35e-6f59-4166-bc0d-77f331bb758b', 'count': 9 },
    { 'viewingId': '6cfdf85c-f36a-452e-b43c-09e6bce23b12', 'count': 63 },
    { 'viewingId': 'ac516954-b932-4776-8628-75fa5fe28536', 'count': 46 },
    { 'viewingId': '5c6bf67c-0035-42f0-83f2-cf7edef8c018', 'count': 46 },
    { 'viewingId': '38840ded-4d54-4747-817e-27a2ce008e3c', 'count': 28 },
    { 'viewingId': 'dc273e72-af87-4d06-8cec-ac0092ec2dd7', 'count': 46 },
    { 'viewingId': 'b1887270-7c83-46dd-a7cf-749e36fed5a6', 'count': 46 },
    { 'viewingId': 'a98e9c26-f5fa-4e39-900e-4e9c0edeb6e5', 'count': 46 },
    { 'viewingId': '47c347a7-c50f-48a7-b16b-d6f33a1aeb08', 'count': 63 },
    { 'viewingId': 'a98b2273-3367-46c3-8a76-f7e396eed17e', 'count': 18 },
    { 'viewingId': '6c90e1f7-f29a-4460-9753-c7742920a2e9', 'count': 44 },
    { 'viewingId': 'fdf1a31a-4b1d-461f-9e82-f6be69c56f18', 'count': 18 },
    { 'viewingId': 'a761f101-4ae9-4c97-bb56-d44d65192864', 'count': 9 },
    { 'viewingId': '188bb0d2-3f60-4aad-b6c4-7964648d4341', 'count': 47 },
    { 'viewingId': '761a1979-852e-4727-be72-09b545e67bbe', 'count': 46 },
    { 'viewingId': '7da82a5e-aa41-46b2-b8c0-b026a4ebb2e5', 'count': 9 },
    { 'viewingId': '01d6e9fb-d80b-4302-ad17-497a22f3ab68', 'count': 37 },
    { 'viewingId': 'ade36723-8a42-458d-b850-b998c773b7bd', 'count': 46 },
    { 'viewingId': '00780736-48f7-4557-9d13-e1d84a0d1df2', 'count': 46 },
    { 'viewingId': 'bda3765b-aa7f-4da6-96cb-437b89408de7', 'count': 9 },
    { 'viewingId': '35362f69-fe30-4002-aa64-c04ad2a1cb37', 'count': 46 },
    { 'viewingId': '2ff19b4e-a4ad-4667-8c5e-de40cdfe973b', 'count': 46 },
    { 'viewingId': '97c9945d-8100-4070-b97a-dd3748077aa4', 'count': 46 },
    { 'viewingId': '10276173-6940-4292-9b0a-0c8e48641cb6', 'count': 46 },
    { 'viewingId': 'b25e751f-3168-449b-91eb-6fadfb9bc2fe', 'count': 46 },
    { 'viewingId': '69452524-463a-4b05-b97a-903153320b6a', 'count': 46 },
    { 'viewingId': '8bae2bc8-072b-4a11-8594-d80c3fb7f74f', 'count': 9 },
    { 'viewingId': '4d38d170-ed74-4eb4-bfc8-1439f912b869', 'count': 46 },
    { 'viewingId': 'e1384dfa-4749-4c09-94f2-d69452c8b431', 'count': 46 },
    { 'viewingId': '77a18194-c167-464c-814e-d8f3240bd868', 'count': 46 },
    { 'viewingId': 'f48512ee-b76e-44a5-a6ee-63f76f5c87fd', 'count': 46 },
    { 'viewingId': '381c5fe0-2eed-47d2-8eff-7173606c2b70', 'count': 46 },
    { 'viewingId': '64323deb-2494-42c0-bf0d-356ec7b0043a', 'count': 46 },
    { 'viewingId': 'b5e1a948-f87b-43e3-9dde-d7fa0d2fa64e', 'count': 46 },
    { 'viewingId': '35cd4c9c-ad32-42d8-a65b-32310fd69e02', 'count': 46 },
    { 'viewingId': '805e049e-264b-4096-91d1-08769d005e34', 'count': 28 },
    { 'viewingId': '2e043169-593e-4d04-a767-d0b2667bfdaa', 'count': 46 },
    { 'viewingId': '2de46356-c2e0-4c02-93a9-5f692ff173eb', 'count': 46 },
    { 'viewingId': 'f5cffeb7-8fc1-4837-ad3f-9edc215fe528', 'count': 46 },
    { 'viewingId': 'd67cd46f-7995-4edd-a213-2ee8835ed955', 'count': 184 },
    { 'viewingId': '0bbc95f5-3039-42a4-be1e-74618cb66798', 'count': 9 },
    { 'viewingId': '3fbf9557-a83c-488f-a5aa-bc93240e9c79', 'count': 173 },
    { 'viewingId': 'ee9a508c-3228-4f46-93be-82ac10bf27e9', 'count': 46 },
    { 'viewingId': '340cffa7-67ed-4bd3-86c9-34e1bdcf6bbd', 'count': 46 },
    { 'viewingId': '44d65aa6-076e-4411-aa6c-869c1e2244b9', 'count': 46 },
    { 'viewingId': '380962ff-236b-4433-808e-f12c9f51a66c', 'count': 46 },
    { 'viewingId': '8e984580-c9af-4069-995e-a73eae82cd05', 'count': 46 },
    { 'viewingId': '4bdc2ce8-4fc9-430b-9338-9fdfa274abc7', 'count': 46 },
    { 'viewingId': '7360f663-9da7-4e2f-ac69-d9c62282cd74', 'count': 46 },
    { 'viewingId': '231eee3a-8761-4714-8594-138e9aead8d3', 'count': 37 },
    { 'viewingId': 'b258a6a7-b9c9-4a2c-b8ad-1f760a0fb52a', 'count': 46 },
    { 'viewingId': '0ce9f63b-9d2c-42db-b358-8fd1a16eee8f', 'count': 46 },
    { 'viewingId': '2346c3e3-e74b-4b7d-94c4-d06c92397322', 'count': 46 },
    { 'viewingId': '3006b5f1-6de6-49fb-bb3e-15ff86e72695', 'count': 46 },
    { 'viewingId': '3cd0bfd1-7677-4763-9434-e82645098275', 'count': 18 },
    { 'viewingId': '1bb464b3-7b92-4b96-889c-6ae7f8628768', 'count': 46 },
    { 'viewingId': '03cfa98a-7d00-4720-8042-5683ccc2403c', 'count': 46 },
    { 'viewingId': '25becc2f-5018-4f5d-a47a-ba2ebf41cb33', 'count': 46 },
    { 'viewingId': '5739097c-ee8d-48cc-ae77-88d406c02861', 'count': 42 },
    { 'viewingId': '8e1a5712-b813-4442-890a-611caad34dc6', 'count': 46 },
    { 'viewingId': '1dcd8289-fca6-486e-bdb6-bd6baf3076f4', 'count': 46 },
    { 'viewingId': '5ce65ad0-a157-49f3-8831-98275428def5', 'count': 46 }
  ]
  const contributions = runtime.database.get('contributions', debug)
  let entry, state, viewing
  for (let x in viewings) {
    viewing = viewings[x]
    entry = await contributions.find({ viewingId: viewing.viewingId })
    if (!entry) return console.log('no contribution ' + viewing.viewingId)

    state = { $set: { votes: viewing.count } }
    await contributions.update({ viewingId: viewing.viewingId }, state, { upsert: false })
  }
/* */
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

      payload.probi = bson.Decimal128.fromString(payload.probi.toString())
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

      underscore.keys(payload.balances).forEach((key) => {
        payload.balances[key] = bson.Decimal128.fromString(payload.balances[key])
      })
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { balances: payload.balances }
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    }
}

module.exports = exports
