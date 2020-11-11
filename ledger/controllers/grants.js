const boom = require('boom')
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const v2 = {}
const v3 = {}
const v4 = {}
const v5 = {}

v3.read = {
  handler: () => async () => {
    throw boom.badData()
  }
}

v5.read = {
  handler: () => async () => {
    throw boom.badData()
  }
}

v4.read = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v3.claimGrant = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v2.claimGrant = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v4.create = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v2.cohorts = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v2.getCaptcha = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v4.getCaptcha = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

v3.attestations = {
  handler: () => async () => {
    throw boom.resourceGone()
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v3/grants').config(v3.read),
  braveHapi.routes.async().path('/v4/grants').config(v4.read),
  braveHapi.routes.async().path('/v5/grants').config(v5.read),
  braveHapi.routes.async().put().path('/v2/grants/{paymentId}').config(v2.claimGrant),
  braveHapi.routes.async().put().path('/v3/grants/{paymentId}').config(v3.claimGrant),
  braveHapi.routes.async().post().path('/v4/grants').config(v4.create),
  braveHapi.routes.async().path('/v1/attestations/{paymentId}').config(v3.attestations),
  braveHapi.routes.async().put().path('/v2/grants/cohorts').config(v2.cohorts),
  braveHapi.routes.async().path('/v2/captchas/{paymentId}').config(v2.getCaptcha),
  braveHapi.routes.async().path('/v4/captchas/{paymentId}').config(v4.getCaptcha)
]

module.exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('redeem-report')
}
