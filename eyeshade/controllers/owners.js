const bson = require('bson')
const Joi = require('joi')
const underscore = require('underscore')
const uuid = require('uuid')

const batPublisher = require('bat-publisher')
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi

const v1 = {}

let altcurrency

/*
   POST /v1/owners
*/

v1.bulk = {
  handler: (runtime) => {
    return async (request, reply) => {
      const payload = request.payload
      const authorizer = payload.authorizer
      const providers = payload.providers
      const debug = braveHapi.debug(module, request)
      const owners = runtime.database.get('owners', debug)
      const publishers = runtime.database.get('publishers', debug)
      const tokens = runtime.database.get('tokens', debug)
      let info, props, state

      info = {
        name: authorizer.ownerName,
        email: authorizer.verifiedEmail,
        phone: authorizer.ownerPhone
      }
      props = batPublisher.getPublisherProps(authorizer.owner)
      state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend(underscore.omit(authorizer, [ 'owner' ]), {
          authorized: true,
          altcurrency: altcurrency,
          info: info
        }, underscore.pick(props, [ 'providerName', 'providerSuffix', 'providerValue' ]))
      }
      await owners.update({ owner: authorizer.owner }, state, { upsert: true })

      for (let entry of providers) {
        state.$set = underscore.extend(underscore.omit(entry, [ 'publisher', 'show_verification_status' ]), {
          verified: true,
          authorized: true,
          authority: authorizer.owner,
          owner: authorizer.owner,
          visible: entry.show_verification_status || false,
          altcurrency: altcurrency,
          info: info
        })
        await publishers.update({ publisher: entry.publisher }, state, { upsert: true })

        entry.verificationId = uuid.v4().toLowerCase()
        state.$set = underscore.extend(underscore.pick(state.$set, [ 'verified', 'visible' ]), {
          token: entry.verificationId,
          reason: 'bulk loaded',
          authority: authorizer.owner,
          info: info
        })

        await tokens.update({ publisher: entry.publisher, verificationId: entry.verificationId }, state, { upsert: true })
      }

      reply({})
    }
  },
  auth: {
    strategy: 'simple',
    mode: 'required'
  },

  description: 'Creates publisher entries in bulk',
  tags: [ 'api' ],

  validate: {
    query: {
      access_token: Joi.string().guid().optional()
    },
    payload: Joi.object().keys({
      authorizer: Joi.object().keys({
        owner: braveJoi.string().owner().required().description('the owner identity'),
        ownerEmail: Joi.string().email().optional().description('authorizer email address'),
        ownerName: Joi.string().optional().description('authorizer name'),
        ownerPhone: Joi.string().regex(/^\+(?:[0-9][ -]?){6,14}[0-9]$/).required().description('phone number for owner'),
        verifiedEmail: Joi.string().email().required().description('verified email address for owner')
      }),
      providers: Joi.array().min(1).items(Joi.object().keys({
        publisher: braveJoi.string().publisher().required().description('the publisher identity'),
        show_verification_status: Joi.boolean().optional().default(true).description('public display authorized')
      }))
    }).required().description('publisher bulk entries for owner')
  },

  response:
    { schema: Joi.object().length(0) }
}

module.exports.routes = [
  braveHapi.routes.async().post().path('/v1/owners').config(v1.bulk)
]

module.exports.initialize = async (debug, runtime) => {
  altcurrency = runtime.config.altcurrency || 'BAT'

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('owners', debug),
      name: 'owners',
      property: 'owner',
      empty: {
        owner: '',              // 'oauth#' + provider + ':' + (profile.id || profile._id)
        ownerEmail: '',         // profile.email
        ownerName: '',          // profile.username || profile.user
        ownerPhone: '',
        verifiedEmail: '',

        providerName: '',
        providerSuffix: '',
        providerValue: '',

        authorized: false,
        authority: '',

        provider: '',
        altcurrency: '',
        parameters: {},
        info: {},

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { owner: 1 } ],
      others: [ { ownerEmail: 1 }, { ownerName: 1 }, { verifiedEmail: 1 },
                { providerName: 1 }, { providerSuffix: 1 },
                { authorized: 1 }, { authority: 1 },
                { provider: 1 }, { altcurrency: 1 },
                { timestamp: 1 } ]
    }
  ])
}
