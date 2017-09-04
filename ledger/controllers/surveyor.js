const anonize = require('node-anonize2-relic')
const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

const slop = 35

const server = async (request, reply, runtime) => {
  const debug = braveHapi.debug(module, request)
  const surveyorType = request.params.surveyorType
  const surveyorId = request.params.surveyorId
  const surveyors = runtime.database.get('surveyors', debug)
  let entry, surveyor

  if ((surveyorId === 'current') && (surveyorType === 'contribution')) {
    entry = await surveyors.findOne({ surveyorType: surveyorType, active: true })
  } else {
    entry = await surveyors.findOne({ surveyorId: surveyorId })
  }
  if (!entry) reply(boom.notFound('surveyor does not exist: ' + surveyorId))
  else if (entry.surveyorType !== surveyorType) reply(boom.badData('surveyorType mismatch for: ' + surveyorId))
  else {
    surveyor = new anonize.Surveyor(entry.parameters)
    surveyor.surveyorId = entry.surveyorId
    surveyor.surveyorType = entry.surveyorType
    surveyor.payload = entry.payload
    surveyor.parentId = entry.parentId
  }

  return surveyor
}

const registrarType = (surveyorType) => {
  return { contribution: 'persona', voting: 'viewing' }[surveyorType]
}

const validate = (surveyorType, payload) => {
  const fee = Joi.object().keys({ USD: Joi.number().min(1).required() }).unknown(true).required()
  const satoshis = Joi.number().integer().min(1).optional()
  const votes = Joi.number().integer().min(1).max(100).required()
  const schema = {
    contribution: Joi.object().keys({ adFree: Joi.object().keys({ votes: votes, satoshis: satoshis, fee: fee }) }).required()
  }[surveyorType] || Joi.object().max(0)

  return Joi.validate(payload || {}, schema)
}
module.exports.validate = validate

const enumerate = (runtime, surveyorType, payload) => {
  let params = (payload || {}).adFree
  let satoshis = params.satoshis

  if ((surveyorType !== 'contribution') || (typeof params === 'undefined')) return payload

  if (!satoshis) {
    underscore.keys(params.fee).forEach((currency) => {
      const amount = params.fee[currency]
      const rate = runtime.wallet.rates[currency.toUpperCase()]

      if ((satoshis) || (!rate)) return

      satoshis = Math.round((amount / rate) * 1e8)
    })
  }
  if (!satoshis) return

  payload.adFree.satoshis = satoshis
  return payload
}
module.exports.enumerate = enumerate

/*
   GET /v1/surveyor/{surveyorType}/{surveyorId}
 */

v1.read =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const surveyorType = request.params.surveyorType
    let surveyor

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    reply(underscore.extend({ payload: surveyor.payload }, surveyor.publicInfo()))

    if (surveyorType === 'contribution') provision(debug, runtime, surveyor.surveyorId)
  }
},

  description: 'Returns information about a surveyor',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor')
    }
  },

  response: {
    schema: Joi.object().keys({
      surveyorId: Joi.string().required().description('identifier for the surveyor'),
      surveyVK: Joi.string().required().description('public key for the surveyor'),
      registrarVK: Joi.string().required().description('public key for the associated registrar'),
      payload: Joi.object().required().description('additional information')
    })
  }
}

/*
   POST /v1/surveyor/{surveyorType}
 */

v1.create =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const surveyorType = request.params.surveyorType
    let surveyor, validity
    let payload = request.payload || {}

    validity = validate(surveyorType, payload)
    if (validity.error) return reply(boom.badData(validity.error))

    payload = enumerate(runtime, surveyorType, payload)
    if (!payload) return reply(boom.badData('no available currencies'))

    surveyor = await create(debug, runtime, surveyorType, payload)
    if (!surveyor) return reply(boom.notFound('invalid surveyorType: ' + surveyorType))

    reply(underscore.extend({ payload: payload }, surveyor.publicInfo()))
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Creates a new surveyor',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor')
    },
    payload: Joi.object().optional().description('additional information')
  },

  response: {
    schema: Joi.object().keys({
      surveyorId: Joi.string().required().description('identifier for the surveyor'),
      surveyVK: Joi.string().required().description('public key for the surveyor'),
      registrarVK: Joi.string().required().description('public key for the associated registrar'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

/*
   PATCH /v1/surveyor/{surveyorType}/{surveyorId}
 */

v1.update =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const surveyorType = request.params.surveyorType
    const surveyors = runtime.database.get('surveyors', debug)
    let state, surveyor, validity
    let payload = request.payload || {}

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    validity = validate(surveyorType, payload)
    if (validity.error) return reply(boom.badData(validity.error))

    payload = enumerate(runtime, surveyorType, payload)
    if (!payload) return reply(boom.badData('no available currencies'))

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { payload: payload } }
    await surveyors.update({ surveyorId: surveyor.surveyorId }, state, { upsert: false })

    if (surveyorType === 'contribution') {
      await runtime.queue.send(debug, 'surveyor-report',
                               underscore.extend({ surveyorId: surveyor.surveyorId, surveyorType: surveyorType },
                                                 underscore.pick(payload.adFree, [ 'satoshis', 'votes' ])))
    }

    surveyor.payload = payload
    reply(underscore.extend({ payload: payload }, surveyor.publicInfo()))

    if (surveyorType === 'contribution') provision(debug, runtime, surveyor.surveyorId)
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Updates a surveyor',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor')
    },
    payload: Joi.object().optional().description('additional information')
  },

  response: {
    schema: Joi.object().keys({
      surveyorId: Joi.string().required().description('identifier for the surveyor'),
      surveyVK: Joi.string().required().description('public key for the surveyor'),
      registrarVK: Joi.string().required().description('public key for the associated registrar'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

/*
   GET /v1/surveyor/{surveyorType}/{surveyorId}/{uId}
 */

v1.phase1 =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const surveyorId = request.params.surveyorId
    const surveyorType = request.params.surveyorType
    const uId = request.params.uId.toLowerCase()
    const credentials = runtime.database.get('credentials', debug)
    let entry, f, registrar, signature, surveyor

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    registrar = runtime.registrars[registrarType(surveyorType)]
    if (!registrar) return reply(boom.badImplementation('unable to find registrar for ' + surveyorType))

    entry = await credentials.findOne({ uId: uId, registrarId: registrar.registrarId })

    f = {
      contribution:
            async () => {
              if (!entry) return reply(boom.notFound('personaId not valid: ' + uId))
            },

      voting:
            async () => {
              const viewings = runtime.database.get('viewings', debug)
              let viewing

              if (!entry) return reply(boom.notFound('viewingId not valid(1): ' + uId))

              viewing = await viewings.findOne({ uId: uId })
              if (!viewing) return reply(boom.notFound('viewingId not valid(2): ' + uId))

              if (viewing.surveyorIds.indexOf(surveyorId) === -1) return reply(boom.notFound('viewingId not valid(3): ' + uId))
            }
    }[surveyor.surveyorType]
    if ((!!f) && (await f())) return

    signature = surveyor.sign(uId)

    reply(underscore.extend({ signature: signature, payload: surveyor.payload }, surveyor.publicInfo()))
  }
},

  description: 'Generates an initialization response for a surveyor',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier')
    }
  },

  response: {
    schema: Joi.object().keys({
      surveyorId: Joi.string().required().description('identifier for the surveyor'),
      surveyVK: Joi.string().required().description('public key for the surveyor'),
      registrarVK: Joi.string().required().description('public key for the associated registrar'),
      signature: Joi.string().required().description('initialization response for the surveyor'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

/*
   PUT /v1/surveyor/{surveyorType}/{surveyorId}
 */

v1.phase2 =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const proof = request.payload.proof
    const submissions = runtime.database.get('submissions', debug)
    let data, entry, f, response, result, state, submissionId, surveyor

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    try {
      result = surveyor.verify(proof)
      data = JSON.parse(result.data)
    } catch (ex) {
      return reply(boom.badData('invalid surveyor proof: ' + JSON.stringify(proof)))
    }
    submissionId = result.token

    entry = await submissions.findOne({ submissionId: submissionId })
    if (entry) {
// NB: in case of a network error on the response (or a premature Heroku 503, etc.)
      return reply(entry.response)
    }

    response = { submissionId: submissionId }
    f = {
      contribution:
            async () => {
              const schema = Joi.object().keys({ viewingId: Joi.string().guid().required() })
              const validity = Joi.validate(data.report, schema)

              if (validity.error) return reply(boom.badData(validity.error))
            },

      voting:
            async () => {
              const schema = Joi.object().keys({ publisher: braveJoi.string().publisher().required() })
              const validity = Joi.validate(data, schema)

              if (validity.error) return reply(boom.badData(validity.error))

              await runtime.queue.send(debug, 'voting-report', underscore.extend({ surveyorId: surveyor.parentId }, data))
            }
    }[surveyor.surveyorType]
    if ((!!f) && (await f())) return

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { response: response } }
    await submissions.update({ submissionId: submissionId }, state, { upsert: true })

    reply(response)
  }
},

  description: 'Submits a completed report',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor')
    },

    payload: { proof: Joi.string().required().description('report information and proof') }
  },

  response:
    { schema: Joi.object().keys({ submissionId: Joi.string().required().description('verification submissionId') }) }
}

const create = async (debug, runtime, surveyorType, payload, parentId) => {
  const surveyors = runtime.database.get('surveyors', debug)
  let registrar, state, surveyor

  registrar = runtime.registrars[registrarType(surveyorType)]
  if (!registrar) return

  surveyor = new anonize.Surveyor().initialize(registrar.publicInfo().registrarVK)
  surveyor.surveyorId = surveyor.parameters.surveyorId
  surveyor.surveyorType = surveyorType
  surveyor.payload = payload

  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: underscore.extend({
      surveyorType: surveyorType,
      active: surveyorType !== 'contribution',
      available: true,
      payload: payload
    }, surveyor)
  }
  if (parentId) state.$set.parentId = parentId
  await surveyors.update({ surveyorId: surveyor.surveyorId }, state, { upsert: true })

  if (surveyorType !== 'contribution') return surveyor

  provision(debug, runtime, surveyor.surveyorId)

  state = { $set: { active: false } }
  await surveyors.update({ surveyorType: 'contribution', active: true }, state, { upsert: false, multi: true })

  state = { $set: { active: true } }
  await surveyors.update({ surveyorId: surveyor.surveyorId }, state, { upsert: false })

  await runtime.queue.send(debug, 'surveyor-report',
                           underscore.extend({ surveyorId: surveyor.surveyorId, surveyorType: surveyorType },
                                             underscore.pick(payload.adFree, [ 'satoshis', 'votes' ])))

  return surveyor
}
module.exports.create = create

const provision = async (debug, runtime, surveyorId) => {
  const surveyors = runtime.database.get('surveyors', debug)
  let entries, entry

  if (surveyorId) {
    entries = []
    entry = await surveyors.findOne({ surveyorId: surveyorId })
    if (entry) entries.push(entry)
  } else {
    entries = await surveyors.find({ surveyorType: 'contribution', available: true }, { limit: 1000, sort: { timestamp: -1 } })
  }
  entries.forEach(async (entry) => {
    const viewings = runtime.database.get('viewings', debug)
    let count, fixupP, surveyor, viewers

    if (!entry.surveyors) entry.surveyors = []
    count = ((entry.payload.adFree.votes * 4) + slop) - entry.surveyors.length
    if (count < 1) return

    debug('surveyor', 'creating ' + count + ' voting surveyors for ' + entry.surveyorId)
    if (entry.surveyors.length !== 0) fixupP = true
    while (count > 0) {
      surveyor = await create(debug, runtime, 'voting', {}, entry.surveyorId)
      if (!surveyor) return debug('surveyor', 'unable to create ' + count + ' voting surveyors')

      entry.surveyors.push(surveyor.surveyorId)

      count--
    }

    await surveyors.update({ surveyorId: entry.surveyorId }, { $set: { surveyors: entry.surveyors } }, { upsert: true })

    if (!fixupP) return

    viewers = await viewings.find({ surveyorId: entry.surveyorId })
    viewers.forEach(async (viewing) => {
      let state

      const params = {
        surveyorId: entry.surveyorId,
        avail: entry.surveyors.length,
        viewingId: viewing.viewingId,
        needed: viewing.count
      }
      if (viewing.surveyorIds.length >= params.needed) return debug('fixup not needed', params)

      if (params.avail < params.needed) return debug('fixup not possible', params)

      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { surveyorIds: underscore.shuffle(entry.surveyors).slice(0, viewing.count) }
      }
      await viewings.update({ viewingId: viewing.viewingId }, state, { upsert: true })

      return debug('fixup complete', params)
    })
  })
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/surveyor/{surveyorType}/{surveyorId}').config(v1.read),
  braveHapi.routes.async().post().path('/v1/surveyor/{surveyorType}').config(v1.create),
  braveHapi.routes.async().patch().path('/v1/surveyor/{surveyorType}/{surveyorId}').config(v1.update),
  braveHapi.routes.async().path('/v1/surveyor/{surveyorType}/{surveyorId}/{uId}').config(v1.phase1),
  braveHapi.routes.async().put().path('/v1/surveyor/{surveyorType}/{surveyorId}').config(v1.phase2)
]

module.exports.initialize = async (debug, runtime) => {
  const configurations = process.env.SURVEYORS || 'contribution,voting'
  const surveyors = runtime.database.get('surveyors', debug)
  let entry, i, service, services, surveyor, surveyorType

  runtime.database.checkIndices(debug, [
    {
      category: surveyors,
      name: 'surveyors',
      property: 'surveyorId',
      empty: { surveyorId: '', surveyorType: '', active: false, available: false, payload: {}, timestamp: bson.Timestamp.ZERO },
      unique: [ { surveyorId: 1 } ],
      others: [ { surveyorType: 1 }, { active: 1 }, { available: 1 }, { timestamp: 1 } ]
    },
    {
      category: runtime.database.get('submissions', debug),
      name: 'submissions',
      property: 'submissionId',
      empty: { submissionId: '', surveyorId: '', timestamp: bson.Timestamp.ZERO },
      unique: [ { submissionId: 1 } ],
      others: [ { surveyorId: 1 }, { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('surveyor-report')
  await runtime.queue.create('voting-report')

  services = configurations.split(',')
  for (i = services.length - 1; i >= 0; i--) {
    service = services[i].split(':')
    surveyorType = service[0]

    entry = await surveyors.findOne({ surveyorType: surveyorType, active: true })
    if (entry) {
      surveyor = new anonize.Surveyor(entry.parameters)
      surveyor.surveyorId = entry.surveyorId
      surveyor.surveyorType = surveyorType
      surveyor.payload = entry.payload

      if ((surveyorType === 'contribution') ||
            ((typeof process.env.DYNO !== 'undefined') && (process.env.DYNO !== 'web.1'))) continue

      setTimeout(() => { provision(debug, runtime, surveyor.surveyorId) }, 5 * 1000)
    }
  }
}
