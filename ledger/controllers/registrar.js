const Joi = require('@hapi/joi')
const boom = require('boom')
const crypto = require('crypto')
const underscore = require('underscore')
const { verify } = require('http-request-signature')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const braveJoi = utils.extras.joi
const { btoa } = utils.extras.utils

const v1 = {}
const v2 = {}

/*
   GET /v1/registrar/{registrarType}
   GET /v2/registrar/{registrarType}
 */

v2.read =
{
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

/*
   PATCH /v1/registrar/{registrarType}
   PATCH /v2/registrar/{registrarType}
 */

v2.update =
{
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

/*
   POST /v1/registrar/persona/{uId}
   POST /v2/registrar/persona/{uId}
 */
const createPersona = function (runtime) {
  return async (request, h) => {
    if (runtime.config.disable.wallets) {
      throw boom.serverUnavailable()
    }
    const debug = braveHapi.debug(module, request)
    const response = {}
    let requestSchema

    const requestType = request.payload.requestType

    if (requestType === 'httpSignature') {
      // TODO consider moving this to a custom joi validator along with signature verif below
      requestSchema = Joi.object().keys({
        headers: Joi.object().keys({
          signature: Joi.string().required(),
          digest: Joi.string().required()
        }).required(),
        body: Joi.object().keys({
          label: Joi.string().required(),
          currency: Joi.string().required(),
          publicKey: Joi.string().required()
        }).required(),
        octets: Joi.string().optional().description('octet string that was signed and digested')
      }).required()
    }
    const validity = requestSchema.validate(request.payload.request)
    if (validity.error) {
      throw boom.badData(validity.error)
    }

    if (requestType === 'httpSignature') {
      const expectedDigest = 'SHA-256=' + crypto.createHash('sha256').update(request.payload.request.octets, 'utf8').digest('base64')
      if (expectedDigest !== request.payload.request.headers.digest) {
        throw boom.badData('the digest specified is not valid for the body provided')
      }

      try {
        const validity = verify({
          headers: request.payload.request.headers,
          publicKey: request.payload.request.body.publicKey
        }, {
          algorithm: 'ed25519'
        })
        if (!validity.verified) {
          throw boom.badData('wallet creation request failed validation, http signature was not valid')
        }
      } catch (e) {
        throw boom.boomify(e)
      }
    }

    const requestBody = request.payload.request

    let id
    if (runtime.config.forward.wallets) {
      const { payload } = await runtime.wreck.walletMigration.post(debug, '/v3/wallet/uphold', {
        payload: {
          signedCreationRequest: btoa(JSON.stringify(requestBody))
        }
      })
      const body = JSON.parse(payload.toString())
      id = body.walletProvider.id
      const paymentId = body.paymentId
      // skip all other collection updates
      return {
        wallet: { paymentId, addresses: { CARD_ID: id } }
      }
    }
    return underscore.extend(response)
  }
}

/*
   POST /v1/registrar/viewing/{uId}
   POST /v2/registrar/viewing/{uId}
 */
const createViewing = function () {
  return async () => {
    throw boom.resourceGone()
  }
}

v2.createViewing =
{
  handler: createViewing
}

const keychainSchema = Joi.object().keys({
  xpub: braveJoi.string().Xpub().required(),
  path: Joi.string().optional(),
  encryptedXprv: Joi.string().optional()
})

v1.createPersona =
{
  handler: (runtime) => createPersona(runtime, 1),
  description: 'Registers a user persona',
  tags: ['api'],

  validate: {
    params: Joi.object().keys({
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier')
    }).unknown(true),
    payload: Joi.object().keys({
      proof: Joi.string().required().description('credential registration request'),
      keychains: Joi.object().keys({ user: keychainSchema.required(), backup: keychainSchema.optional() })
    }).unknown(true).required()
  },

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      wallet: Joi.object().keys({
        paymentId: Joi.string().guid().required().description('opaque identifier for BTC address'),
        address: braveJoi.string().base58().required().description('BTC address')
      }).optional().description('wallet information'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

v2.createPersona =
{
  handler: (runtime) => createPersona(runtime, 2),
  description: 'Registers a user persona',
  tags: ['api'],

  validate: {
    params: Joi.object().keys({
      uId: Joi.string().hex().length(31).required().description('the universally-unique identifier')
    }).unknown(true),
    payload: Joi.object().keys({
      requestType: Joi.string().valid('httpSignature').required().description('the type of the request'),
      request: Joi.object().required().description('wallet registration request'),
      proof: Joi.string().required().description('credential registration request')
    }).unknown(true).required()
  },

  response: {
    schema: Joi.object().keys({
      verification: Joi.string().required().description('credential registration response'),
      wallet: Joi.object().keys({
        paymentId: Joi.string().guid().required().description('opaque identifier for BTC address'),
        addresses: Joi.object().keys({
          BTC: braveJoi.string().altcurrencyAddress('BTC').optional().description('BTC address'),
          BAT: braveJoi.string().altcurrencyAddress('BAT').optional().description('BAT address'),
          CARD_ID: Joi.string().guid().optional().description('Card id'),
          ETH: braveJoi.string().altcurrencyAddress('ETH').optional().description('ETH address'),
          LTC: braveJoi.string().altcurrencyAddress('LTC').optional().description('LTC address')
        })
      }).optional().description('wallet information'),
      payload: Joi.object().optional().description('additional information')
    })
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/{apiV}/registrar/{registrarType}').config(v2.read),
  braveHapi.routes.async().patch().path('/{apiV}/registrar/{registrarType}').config(v2.update),
  braveHapi.routes.async().post().path('/v1/registrar/persona/{uId}').config(v1.createPersona),
  braveHapi.routes.async().post().path('/v2/registrar/persona/{uId}').config(v2.createPersona),
  braveHapi.routes.async().post().path('/{apiV}/registrar/viewing/{uId}').config(v2.createViewing)
]

module.exports.initialize = async (debug, runtime) => {
  try {
    await runtime.queue.create('persona-report')
  } catch (e) {
    if (e.name !== 'queueExists') {
      throw e
    }
  }

  runtime.registrars = []
}
