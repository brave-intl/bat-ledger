const url = require('url')

const boom = require('boom')
const bson = require('bson')
const Joi = require('joi')
const batPublisher = require('bat-publisher')
const underscore = require('underscore')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

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

      entry = await publishers.findOne({ publisher: result.publisher })
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

module.exports.routes = [
  braveHapi.routes.async().path('/v3/publisher/identity').config(v3.identity),
  braveHapi.routes.async().path('/v3/publisher/timestamp').config(v3.timestamp)
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
      others: [ { facet: 1 }, { exclude: 1 }, { timestamp: 1 },
                { publisher: 1, facet: 1 } ]
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
