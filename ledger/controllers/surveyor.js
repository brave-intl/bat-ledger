const Joi = require('joi')
const anonize = require('node-anonize2-relic')
const boom = require('boom')
const bson = require('bson')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v2 = {}

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

const validateV1 = (surveyorType, payload) => {
  const fee = Joi.object().keys({ USD: Joi.number().min(1).required() }).unknown(true).required()
  const satoshis = Joi.number().integer().min(1).optional()
  const votes = Joi.number().integer().min(1).max(100).required()
  const schema = {
    contribution: Joi.object().keys({ adFree: Joi.object().keys({ votes: votes, satoshis: satoshis, fee: fee }) }).required()
  }[surveyorType] || Joi.object().max(0)

  return Joi.validate(payload || {}, schema)
}

const validateV2 = (surveyorType, payload) => {
  const fee = Joi.object().keys({ USD: Joi.number().min(1).required() }).unknown(true).required()
  const altcurrency = braveJoi.string().altcurrencyCode().optional()
  const probi = braveJoi.string().numeric().optional()
  const votes = Joi.number().integer().min(1).max(100).required()
  const schema = {
    contribution: Joi.object().keys({ adFree: Joi.object().keys({ votes: votes, altcurrency: altcurrency, probi: probi, fee: fee }) }).required()
  }[surveyorType] || Joi.object().max(0)

  return Joi.validate(payload || {}, schema)
}

module.exports.validate = validateV2

const enumerate = (runtime, surveyorType, payload) => {
  payload.adFree.altcurrency = payload.adFree.altcurrency || 'BTC'
  let params = (payload || {}).adFree
  let probi = params.probi

  if ((surveyorType !== 'contribution') || (typeof params === 'undefined')) return payload

  if (!probi) {
    underscore.keys(params.fee).forEach((currency) => {
      const amount = params.fee[currency]

      if (probi) return

      probi = runtime.currency.fiat2alt(currency, amount, params.altcurrency).toString()
      params.probi = probi
    })
  }
  if (!probi) return

  return payload
}
module.exports.enumerate = enumerate

/*
   GET /v1/surveyor/{surveyorType}/{surveyorId}
   GET /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.read =
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
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
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
   POST /v2/surveyor/{surveyorType}
 */

v2.create =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const surveyorType = request.params.surveyorType
    let surveyor, validity
    let payload = request.payload || {}

    if (request.params.apiV === 'v1') {
      validity = validateV1(surveyorType, payload)
    } else {
      validity = validateV2(surveyorType, payload)
    }

    if (validity.error) return reply(boom.badData(validity.error))

    if (request.params.apiV === 'v1') {
      payload.adFree = underscore.omit(underscore.extend(payload.adFree, { probi: payload.adFree.satoshis.toString() }), ['satoshis'])
    }

    payload = enumerate(runtime, surveyorType, payload)
    if (!payload) return reply(boom.badData('no available currencies'))

    surveyor = await create(debug, runtime, surveyorType, payload)
    if (!surveyor) return reply(boom.notFound('invalid surveyorType: ' + surveyorType))

    if (request.params.apiV === 'v1') {
      payload.adFree = underscore.omit(underscore.extend(payload.adFree, { satoshis: Number(payload.adFree.probi) }), ['altcurrency', 'probi'])
    }

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
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
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
   PATCH /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.update =
{ handler: (runtime) => {
  return async (request, reply) => {
    const bump = request.query.bump
    const surveyorType = request.params.surveyorType
    const debug = braveHapi.debug(module, request)
    const surveyors = runtime.database.get('surveyors', debug)
    let state, surveyor, validity
    let payload = request.payload

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    if (request.params.apiV === 'v1') {
      validity = validateV1(surveyorType, payload)
    } else {
      validity = validateV2(surveyorType, payload)
    }

    if (validity.error) return reply(boom.badData(validity.error))

    if (request.params.apiV === 'v1') {
      payload.adFree = underscore.omit(underscore.extend(payload.adFree, { probi: payload.adFree.satoshis.toString() }), ['satoshis'])
    }

    payload = enumerate(runtime, surveyorType, payload)
    if (!payload) return reply(boom.badData('no available currencies'))

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: { payload: payload } }
    await surveyors.update({ surveyorId: surveyor.surveyorId }, state, { upsert: false })

    if (surveyorType === 'contribution') {
      await runtime.queue.send(debug, 'surveyor-report',
                               underscore.extend({ surveyorId: surveyor.surveyorId, surveyorType: surveyorType },
                                                 underscore.pick(payload.adFree, [ 'altcurrency', 'probi', 'votes' ])))
    }

    if (request.params.apiV === 'v1') {
      payload = underscore.omit(underscore.extend(payload, { satoshis: Number(payload.probi) }), ['altcurrency', 'probi'])
    }

    surveyor.payload = payload
    reply(underscore.extend({ payload: payload }, surveyor.publicInfo()))

    if (surveyorType === 'contribution') provision(debug, runtime, surveyor.surveyorId, bump)
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
    query: {
      bump: Joi.number().integer().min(1).max(100).optional().description('number of additional requested surveyors')
    },
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
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
   GET /v2/surveyor/{surveyorType}/{surveyorId}/{uId}
 */

v2.phase1 =
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

    const now = underscore.now()
    signature = surveyor.sign(uId)
    runtime.newrelic.recordCustomEvent('sign', {
      surveyorId: surveyor.surveyorId,
      surveyorType: surveyor.surveyorType,
      duration: underscore.now() - now
    })

    var payload = surveyor.payload
    if (request.params.apiV === 'v1') {
      if (payload.adFree) {
        payload.adFree = underscore.omit(underscore.extend(payload.adFree, { satoshis: Number(payload.adFree.probi) }), ['altcurrency', 'probi'])
      }
    }

    reply(underscore.extend({ signature: signature, payload: payload }, surveyor.publicInfo()))
  }
},

  description: 'Generates an initialization response for a surveyor',
  tags: [ 'api' ],

  validate: {
    params: {
      surveyorType: Joi.string().valid('contribution', 'voting').required().description('the type of the surveyor'),
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
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
   PUT /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.phase2 =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const proof = request.payload.proof
    const submissions = runtime.database.get('submissions', debug)
    let data, entry, f, response, result, state, submissionId, surveyor

    surveyor = await server(request, reply, runtime)
    if (!surveyor) return

    try {
      const now = underscore.now()
      result = surveyor.verify(proof)
      runtime.newrelic.recordCustomEvent('verify', {
        surveyorId: surveyor.surveyorId,
        surveyorType: surveyor.surveyorType,
        duration: underscore.now() - now
      })
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

              await runtime.queue.send(debug, 'voting-report', underscore.extend({ surveyorId: surveyor.parentId, cohort: surveyor.payload.cohort || 'control' }, data))
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
      surveyorId: Joi.string().required().description('the identity of the surveyor'),
      apiV: Joi.string().valid('v1', 'v2').required().description('the api version')
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
                                             underscore.pick(payload.adFree, [ 'altcurrency', 'probi', 'votes' ])))

  return surveyor
}
module.exports.create = create

const provision = async (debug, runtime, surveyorId, bump) => {
  const surveyors = runtime.database.get('surveyors', debug)
  let contributionSurveyors

  if (surveyorId) {
    contributionSurveyors = []
    const matchingSurveyor = await surveyors.findOne({ surveyorId: surveyorId })
    if (matchingSurveyor) contributionSurveyors.push(matchingSurveyor)
  } else {
    contributionSurveyors = await surveyors.find({ surveyorType: 'contribution', available: true }, { limit: 1000, sort: { timestamp: -1 } })
  }
  if (!bump) bump = 0

  contributionSurveyors.forEach(async (cSurveyor) => {
    const cohorts = process.env.VOTING_COHORTS ? process.env.VOTING_COHORTS.split(',') : ['control', 'grant']
    let count, vSurveyor

    if (!cSurveyor.cohorts) cSurveyor.cohorts = {}

    const desiredCount = ((cSurveyor.payload.adFree.votes * 4) + bump + slop)

    for (let cohort of cohorts) {
      if (!cSurveyor.cohorts[cohort]) cSurveyor.cohorts[cohort] = []

      count = desiredCount - cSurveyor.cohorts[cohort].length
      while (count > 0) {
        vSurveyor = await create(debug, runtime, 'voting', { cohort: cohort }, cSurveyor.surveyorId)
        if (!vSurveyor) {
          debug('surveyor', 'unable to create ' + count + ' voting surveyors')
          return
        }

        cSurveyor.cohorts[cohort].push(vSurveyor.surveyorId)

        count--
      }
    }

    await surveyors.update({ surveyorId: cSurveyor.surveyorId }, { $set: { cohorts: cSurveyor.cohorts } }, { upsert: true })
  })
}

/*
   POST /{apiV}/batch/surveyor/voting
 */

v2.batch =
{ handler: (runtime) => {
  return async (request, reply) => {
    const f = v2.phase2(runtime)
    const id = request.id
    const params = request.params
    const payload = request.payload
    const results = []

    for (let item of payload) {
      // only these three properties are needed...
      await f({
        id: id,
        params: underscore.extend({ surveyorType: 'voting', surveyorId: item.surveyorId }, params),
        payload: { proof: item.proof }
      }, (response) => {
        results.push({ surveyorId: item.surveyorId, response: response })
      })
    }

    return results
  }
},

  description: 'Submits a completed report',
  tags: [ 'api' ],

  validate: {
    params: { apiV: Joi.string().valid('v2').required().description('the api version') },

    payload: Joi.array().min(1).items(
      Joi.object().keys({
        surveyorId: Joi.string().required().description('the identity of the surveyor'),
        proof: Joi.string().required().description('report information and proof')
      })
    )
  },

  response: {
    schema: Joi.array().min(1).items(
      Joi.object().keys({
        surveyorId: Joi.string().required().description('the identity of the surveyor'),

        response: Joi.alternatives().try(
          Joi.object().keys({
            submissionId: Joi.string().required().description('verification submissionId')
          }),

          Joi.object().keys({
            statusCode: Joi.number().min(400).max(599).required(),
            error: Joi.string().optional(),
            message: Joi.string().optional()
          }).description('boom result')
        )
      })
    )
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.read),
  braveHapi.routes.async().post().path('/{apiV}/surveyor/{surveyorType}').config(v2.create),
  braveHapi.routes.async().patch().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.update),
  braveHapi.routes.async().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}/{uId}').config(v2.phase1),
  braveHapi.routes.async().put().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.phase2),
  braveHapi.routes.async().post().path('/{apiV}/batch/surveyor/voting').config(v2.batch)
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
