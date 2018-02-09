const url = require('url')

const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const batPublisher = require('bat-publisher')
const underscore = require('underscore')
const uuid = require('uuid')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}
const v2 = {}
const v3 = {}

const rulesetId = 1

const rulesetEntry = async (request, runtime) => {
  const debug = braveHapi.debug(module, request)
  const version = batPublisher.version
  const rulesets = runtime.database.get('rulesets', debug)
  let entry

  entry = await rulesets.findOne({ rulesetId: rulesetId })
  if ((!entry) || (entry.version.indexOf(version) !== 0)) {
    if (entry) rulesets.remove({ rulesetId: rulesetId })

    entry = {
      ruleset: typeof batPublisher.ruleset === 'function' ? batPublisher.ruleset() : batPublisher.ruleset,
      version: version
    }
  }

  return entry
}

const rulesetEntryV2 = async (request, runtime) => {
  const entryV2 = await rulesetEntry(request, runtime)
  let ruleset = []

  entryV2.ruleset.forEach(rule => { if (rule.consequent) ruleset.push(rule) })
  ruleset = [
    { condition: 'SLD === \'twitch.com\'',
      consequent: '\'twitch#channel:\' + pathname.split(\'/\')[1]',
      description: 'twitch channels'
    },
    { condition: 'SLD === \'youtube.com\' && pathname.indexOf(\'/channel/\') === 0',
      consequent: '\'youtube#channel:\' + pathname.split(\'/\')[2]',
      description: 'youtube channels'
    },
    { condition: '/^[a-z][a-z].gov$/.test(SLD)',
      consequent: 'QLD + "." + SLD',
      description: 'governmental sites'
    },
    { condition: "TLD === 'gov' || /^go.[a-z][a-z]$/.test(TLD) || /^gov.[a-z][a-z]$/.test(TLD)",
      consequent: 'SLD',
      description: 'governmental sites'
    },
    {
      condition: "SLD === 'keybase.pub'",
      consequent: 'QLD + \'.\' + SLD',
      description: 'keybase users'
    }
  ].concat(ruleset)
  return { ruleset: ruleset, version: entryV2.version }
}

const publisherV2 = { publisher: Joi.string().required().description('the publisher identity') }

const propertiesV2 =
  {
    facet: Joi.string().valid('domain', 'SLD', 'TLD').optional().default('domain').description('the entry type'),
    exclude: Joi.boolean().optional().default(true).description('exclude from auto-include list'),
    tags: Joi.array().items(Joi.string()).optional().description('taxonomy tags')
  }

const schemaV2 = Joi.object().keys(underscore.extend({}, publisherV2, propertiesV2,
  { timestamp: Joi.string().regex(/^[0-9]+$/).required().description('an opaque, monotonically-increasing value') }
))

/*
   GET /v1/publisher/ruleset
   GET /v2/publisher/ruleset
 */

v1.read =
{ handler: (runtime) => {
  return async (request, reply) => {
    const consequential = request.query.consequential
    const entry = consequential ? (await rulesetEntryV2(request, runtime)) : (await rulesetEntry(request, runtime))

    reply(entry.ruleset)
  }
},

  description: 'Returns the publisher identity ruleset',
  tags: [ 'api' ],

  validate:
    { query: { consequential: Joi.boolean().optional().default(false).description('return only consequential rules') } },

  response:
    { schema: batPublisher.schema }
}

v2.read =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const excludedOnly = request.query.excludedOnly
    const publishers = runtime.database.get('publishersV2', debug)
    let entries, modifiers, query, result
    let limit = parseInt(request.query.limit, 10)
    let timestamp = request.query.timestamp

    try { timestamp = (timestamp || 0) ? bson.Timestamp.fromString(timestamp) : bson.Timestamp.ZERO } catch (ex) {
      return reply(boom.badRequest('invalid value for the timestamp parameter: ' + timestamp))
    }

    if (isNaN(limit) || (limit > 512)) limit = 512
    query = { timestamp: { $gte: timestamp } }
    modifiers = { sort: { timestamp: 1 } }

    entries = await publishers.find(query, underscore.extend({ limit: limit }, modifiers))
    result = []
    entries.forEach(entry => {
      if ((entry.publisher === '') || (excludedOnly && (entry.exclude !== true))) return

      result.push(underscore.extend(underscore.omit(entry, [ '_id', 'timestamp' ]),
                                    { timestamp: entry.timestamp.toString() }))
    })

    reply(result)
  }
},

  description: 'Returns information about publisher identity ruleset entries',
  tags: [ 'api' ],

  validate: {
    query: {
      timestamp: Joi.string().regex(/^[0-9]+$/).optional().description('an opaque, monotonically-increasing value'),
      limit: Joi.number().positive().optional().description('the maximum number of entries to return'),
      excludedOnly: Joi.boolean().optional().default(true).description('return only excluded sites')
    }
  },

  response:
    { schema: Joi.array().items(schemaV2) }
}

/*
   POST /v2/publisher/ruleset
 */

v2.create =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const payload = request.payload
    const publisher = payload.publisher
    const publishers = runtime.database.get('publishersV2', debug)
    let result

    result = await publishers.findOne({ publisher: publisher })
    if (result) return reply(boom.badData('publisher identity entry already exists: ' + publisher))

    try {
      await publishers.insert(underscore.extend(payload, { timestamp: bson.Timestamp() }))
    } catch (ex) {
      runtime.captureException(ex, { req: request })
      debug('publishers error', { reason: ex.toString(), stack: ex.stack })
      return reply(boom.badData(ex.toString()))
    }

    result = await publishers.findOne({ publisher: publisher })
    if (!result) return reply(boom.badImplementation('database creation failed: ' + publisher))

    result = underscore.extend(underscore.omit(result, [ '_id', 'timestamp' ]), { timestamp: result.timestamp.toString() })

    reply(result)
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Defines information a new publisher identity ruleset entry',
  tags: [ 'api' ],

  validate:
    { payload: underscore.extend({}, publisherV2, propertiesV2) },

  response:
    { schema: schemaV2 }
}

/*
   PATCH /v2/publisher/rulesets
 */

v2.update =
{ handler: (runtime) => {
  return async (request, reply) => {
    const authority = request.auth.credentials.provider + ':' + request.auth.credentials.profile.username
    const reportId = uuid.v4().toLowerCase()
    const reportURL = url.format(underscore.defaults({ pathname: '/v1/reports/file/' + reportId }, runtime.config.server))
    const debug = braveHapi.debug(module, request)

    await runtime.queue.send(debug, 'patch-publisher-rulesets',
                             underscore.defaults({ reportId: reportId, reportURL: reportURL, authority: authority },
                                                 { entries: request.payload }))
    reply({ reportURL: reportURL })
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'devops' ],
    mode: 'required'
  },

  description: 'Batched update of publisher identity ruleset entries',
  tags: [ 'api' ],

  validate:
    { payload: Joi.array().items(Joi.object().keys(underscore.extend(publisherV2, propertiesV2))).required() },

  response: {
    schema: Joi.object().keys({
      reportURL: Joi.string().uri({ scheme: /https?/ }).optional().description('the URL for a forthcoming report')
    }).unknown(true).description('information about the most forthcoming report')
  }
}

/*
   PUT /v2/publisher/ruleset/{publisher}
 */

v2.write =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const publisher = request.params.publisher
    const publishers = runtime.database.get('publishersV2', debug)
    let result, state

    state = { $currentDate: { timestamp: { $type: 'timestamp' } }, $set: request.payload }
    await publishers.update({ publisher: publisher }, state, { upsert: true })

    result = await publishers.findOne({ publisher: publisher })
    if (!result) return reply(boom.badImplementation('database update failed: ' + publisher))

    result = underscore.extend(underscore.omit(result, [ '_id', 'timestamp' ]), { timestamp: result.timestamp.toString() })

    reply(result)
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'devops' ],
    mode: 'required'
  },

  description: 'Sets information for a publisher identity ruleset entry',
  tags: [ 'api' ],

  validate: {
    params: publisherV2,
    payload: Joi.object().keys(propertiesV2)
  },

  response:
    { schema: schemaV2 }
}

/*
   DELETE /v2/publisher/ruleset/{publisher}
 */

v2.delete =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const publisher = request.params.publisher
    const publishers = runtime.database.get('publishersV2', debug)
    let entry

    entry = await publishers.findOne({ publisher: publisher })
    if (!entry) return reply(boom.notFound('no such entry: ' + publisher))

    await publishers.remove({ publisher: publisher })

    reply().code(204)
  }
},

  auth: {
    strategy: 'session',
    scope: [ 'ledger' ],
    mode: 'required'
  },

  description: 'Deletes information a publisher identity ruleset entry',
  tags: [ 'api' ],

  validate:
    { params: publisherV2 },

  response:
    { schema: Joi.any() }
}

/*
   GET /v1/publisher/ruleset/version
 */

v1.version =
{ handler: (runtime) => {
  return async (request, reply) => {
    const entry = await rulesetEntry(request, runtime)

    reply(entry.version)
  }
},

  description: 'Returns the version of the publisher identity ruleset',
  tags: [ 'api' ],

  validate:
    { query: {} },

  response:
    { schema: Joi.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[1-9]+[0-9]*)?$/) }
}

/*
   GET /v1/publisher/identity?url=... (obsolete)

   GET /v2/publisher/identity?url=...
       [ used by publishers ]

   GET /v3/publisher/identity?publisher=...
 */

/*
v1.identity =
{ handler: (runtime) => {
  return async (request, reply) => {
    const url = request.query.url
    let result

    try {
      result = batPublisher.getPublisherProps(url)
      if (result) result.publisher = batPublisher.getPublisher(url)

      reply(result || boom.notFound())
    } catch (ex) {
      reply(boom.badData(ex.toString()))
    }
  }
},

  description: 'Returns the publisher identity associated with a URL',
  tags: [ 'api', 'deprecated' ],

  validate:
    { query: { url: Joi.string().uri({ scheme: /https?/ }).required().description('the URL to parse') } },

  response:
    { schema: Joi.object().optional().description('the publisher identity') }
}
 */

const identity = async (debug, runtime, result) => {
  const publishers = runtime.database.get('publishersV2', debug)
  let entry

  const re = (value, entries) => {
    entries.forEach((reEntry) => {
      let regexp

      if ((entry) ||
          (underscore.intersection(reEntry.publisher.split(''),
                                [ '^', '$', '*', '+', '?', '[', '(', '{', '|' ]).length === 0)) return

      try {
        regexp = new RegExp(reEntry.publisher)
        if (regexp.test(value)) entry = reEntry
      } catch (ex) {
        debug('invalid regexp ' + reEntry.publisher + ': ' + ex.toString())
      }
    })
  }

  entry = await publishers.findOne({ publisher: result.publisher, facet: 'domain' })

  if (!entry) entry = await publishers.findOne({ publisher: result.SLD.split('.')[0], facet: 'SLD' })
  if (!entry) re(result.SLD, await publishers.find({ facet: 'SLD' }))

  if (!entry) entry = await publishers.findOne({ publisher: result.TLD, facet: 'TLD' })
  if (!entry) re(result.TLD, await publishers.find({ facet: 'TLD' }))

  if (!entry) return {}

  return {
    properties: underscore.omit(entry, [ '_id', 'publisher', 'timestamp' ]),
    timestamp: entry.timestamp.toString()
  }
}

v2.identity =
{ handler: (runtime) => {
  return async (request, reply) => {
    const url = request.query.url
    const debug = braveHapi.debug(module, request)
    let result
    let entry = await rulesetEntryV2(request, runtime)

    try {
      result = batPublisher.getPublisherProps(url)
      if (!result) return reply(boom.notFound())

      if (!result.publisherType) {
        result.publisher = batPublisher.getPublisher(url, entry.ruleset)
        if (result.publisher) underscore.extend(result, await identity(debug, runtime, result))
      }

      reply(result)
    } catch (ex) {
      reply(boom.badData(ex.toString()))
    }
  }
},

  description: 'Returns the publisher identity associated with a URL',
  tags: [ 'api', 'deprecated' ],

  validate:
    { query: { url: Joi.string().uri({ scheme: /https?/ }).required().description('the URL to parse') } },

  response:
    { schema: Joi.object().optional().description('the publisher identity') }
}

v3.identity =
{ handler: (runtime) => {
  return async (request, reply) => {
    const publisher = request.query.publisher
    const location = 'https://' + publisher
    const debug = braveHapi.debug(module, request)
    const publishers = runtime.database.get('publishersX', debug)
    let result, timestamp
    let entry = await rulesetEntryV2(request, runtime)

    try {
      result = batPublisher.getPublisherProps(publisher)
      if (!result) return reply(boom.notFound())

      if (!result.publisherType) {
        result = underscore.omit(result, underscore.keys(url.parse(location, true)), [ 'URL' ])
        result.publisher = batPublisher.getPublisher(location, entry.ruleset)
        if (!result.publisher) return reply(boom.notFound())
      }

      result.properties = {}
      underscore.extend(result, await identity(debug, runtime, result))

      if (result.timestamp) {
        result.properties.timestamp = result.timestamp
        delete result.timestamp
      }

      entry = await publishers.findOne({ publisher: publisher })
      if (entry) {
        timestamp = entry.timestamp.toString()

        if ((timestamp) && ((!result.properties.timestamp) || (timestamp > result.properties.timestamp))) {
          result.properties.timestamp = timestamp
        }
        if (entry.verified) result.properties.verified = entry.verified
      }

      reply(result)
    } catch (ex) {
      reply(boom.badData(ex.toString()))
    }
  }
},

  description: 'Returns information about a publisher identity',
  tags: [ 'api' ],

  validate:
    { query: { publisher: braveJoi.string().publisher().required().description('the publisher identity') } },

  response:
    { schema: Joi.object().optional().description('the publisher identity') }
}

v3.timestamp =
{ handler: (runtime) => {
  return async (request, reply) => {
    const debug = braveHapi.debug(module, request)
    const publishers = runtime.database.get('publishersX', debug)
    const publishersV2 = runtime.database.get('publishersV2', debug)
    let entries, entry, timestamp

    timestamp = '0'

    entries = await publishers.find({}, { limit: 1, sort: { timestamp: -1 } })
    entry = entries && entries[0]
    if ((entry) && (entry.timestamp)) timestamp = entry.timestamp.toString()

    entries = await publishersV2.find({}, { limit: 1, sort: { timestamp: -1 } })
    entry = entries && entries[0]
    if ((entry) && (entry.timestamp)) {
      entry.timestamp = entry.timestamp.toString()
      if (entry.timestamp > timestamp) timestamp = entry.timestamp
    }

    reply({ timestamp: timestamp })
  }
},

  description: 'Returns information about the latest publisher timestamp',
  tags: [ 'api' ],

  validate: {},

  response: {
    schema: Joi.object().keys({
      timestamp: Joi.string().regex(/^[0-9]+$/).required().description('an opaque, monotonically-increasing value')
    }).unknown(true).description('information about the most recent publisher timestamp')
  }
}

/*
   GET /v1/publisher/identity/verified (obsolete)
   GET /v2/publisher/identity/verified
 */

/*
v1.verified =
{ handler: (runtime) => {
  return async (request, reply) => {
    const limit = request.query.limit
    const tld = request.query.tld || { $exists: true }
    const debug = braveHapi.debug(module, request)
    const publishers = runtime.database.get('publishers', debug)
    let entries, result

    entries = await publishers.find({ verified: true, tld: tld }, { fields: { publisher: 1 }, limit: limit })
    result = []
    entries.forEach((entry) => { result.push(entry.publisher) })
    reply(result)
  }
},

  description: 'Returns a list of verified publishers',
  tags: [ 'api', 'deprecated' ],

  validate: {
    query: {
      limit: Joi.number().integer().positive().default(500).description('maximum number of matches'),
      tld: Joi.string().hostname().optional().description('a suffix-matching string')
    }
  },

  response:
    { schema: Joi.array().items(Joi.string()).description('verified publishers') }
}
 */

v2.verified =
{ handler: (runtime) => {
  return async (request, reply) => {
    reply([])
  }
},

  description: 'Returns information about publisher verification entries',
  tags: [ 'api', 'deprecated' ],

  validate: {
    query: {
      timestamp: Joi.string().regex(/^[0-9]+$/).optional().description('an opaque, monotonically-increasing value'),
      limit: Joi.number().positive().optional().description('the maximum number of entries to return'),
      tld: Joi.string().hostname().optional().description('a suffix-matching string')
    }
  },

  response: {
    schema: Joi.array().items(Joi.object().keys({
      publisher: Joi.string().required().description('the publisher identity'),
      verified: Joi.boolean().required().description('verification status'),
      tld: Joi.string().required().description('top-level domain'),
      timestamp: Joi.string().regex(/^[0-9]+$/).required().description('an opaque, monotonically-increasing value')
    }).unknown(true))
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/publisher/ruleset').config(v1.read),
  braveHapi.routes.async().path('/v1/publisher/ruleset/version').config(v1.version),
/*
  braveHapi.routes.async().path('/v1/publisher/identity').config(v1.identity),
*/

  braveHapi.routes.async().path('/v2/publisher/ruleset').config(v2.read),
  braveHapi.routes.async().post().path('/v2/publisher/ruleset').config(v2.create),
  braveHapi.routes.async().patch().path('/v2/publisher/rulesets').config(v2.update),
  braveHapi.routes.async().put().path('/v2/publisher/ruleset/{publisher}').config(v2.write),
  braveHapi.routes.async().delete().path('/v2/publisher/ruleset/{publisher}').config(v2.delete),
  braveHapi.routes.async().path('/v2/publisher/identity').config(v2.identity),

  braveHapi.routes.async().path('/v3/publisher/identity').config(v3.identity),
  braveHapi.routes.async().path('/v3/publisher/timestamp').config(v3.timestamp),

/*
  braveHapi.routes.async().path('/v1/publisher/identity/verified').config(v1.verified),
*/

  braveHapi.routes.async().path('/v2/publisher/identity/verified').config(v2.verified)
]

module.exports.initialize = async (debug, runtime) => {
  const publishers = runtime.database.get('publishersV2', debug)
  const rulesets = runtime.database.get('rulesets', debug)
  let entry, validity

  runtime.database.checkIndices(debug, [
    {
      category: rulesets,
      name: 'rulesets',
      property: 'rulesetId',
      empty: { rulesetId: 0, type: '', version: '', timestamp: bson.Timestamp.ZERO },
      unique: [ { rulesetId: 1 } ],
      others: [ { type: 1 }, { version: 1 }, { timestamp: 1 } ]
    },
/* verified publishers
   - verified should always be "true"
   - visible indicates whether the publisher opted-in to inclusion in marketing materials

   originally this was the 'publishers' table, but was renamed to 'publishersX' to temporarily address a publisher privacy
   issue. however, it was accidentally commented out, which resulted in vanilla servers not getting the indices...
 */
    {
      category: runtime.database.get('publishersX', debug),
      name: 'publishersX',
      property: 'publisher',
      empty: { publisher: '', tld: '', verified: false, visible: false, timestamp: bson.Timestamp.ZERO },
      unique: [ { publisher: 1 } ],
      others: [ { tld: 1 }, { verified: 1 }, { visible: 1 }, { timestamp: 1 } ]
    },
    {
      category: publishers,
      name: 'publishersV2',
      property: 'publisher',
      empty: { publisher: '', facet: '', exclude: false, tags: [], timestamp: bson.Timestamp.ZERO },
      unique: [ { publisher: 1 } ],
      others: [ { facet: 1 }, { exclude: 1 }, { timestamp: 1 } ]
    }
  ])

  entry = await rulesets.findOne({ rulesetId: rulesetId })
  validity = Joi.validate(entry ? entry.ruleset
                                : typeof batPublisher.ruleset === 'function' ? batPublisher.ruleset() : batPublisher.ruleset,
                          batPublisher.schema)
  if (validity.error) throw new Error(validity.error)

  batPublisher.getRules((err, rules) => {
    let validity

    if (err) {
      runtime.newrelic.noticeError(err, { ledgerPublisher: 'getRules' })
      throw err
    }

    if ((!rules) ||
        (underscore.isEqual(typeof batPublisher.ruleset === 'function' ? batPublisher.ruleset() : batPublisher.ruleset,
                            rules))) return

    validity = Joi.validate(rules, batPublisher.schema)
    if (validity.error) {
      runtime.newrelic.noticeError(new Error(validity.error), { ledgerPublisher: 'getRules' })
      throw new Error(validity.error)
    }

    batPublisher.ruleset = rules
  })

  await runtime.queue.create('patch-publisher-rulesets')
}
