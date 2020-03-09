const boom = require('boom')
const bson = require('bson')
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi
const v2 = {}
const v3 = {}
const v4 = {}
const v5 = {}

const safetynetPassthrough = (handler) => (runtime) => async (request, h) => {
  const endpoint = '/v1/attestations/safetynet'
  const {
    config
  } = runtime
  const {
    captcha
  } = config

  const url = captcha.url + endpoint
  const headers = {
    'Authorization': 'Bearer ' + captcha.access_token,
    'Content-Type': 'application/json'
  }
  const body = JSON.stringify({
    token: request.headers['safetynet-token']
  })

  try {
    await braveHapi.wreck.post(url, {
      headers,
      payload: body
    })
  } catch (e) {
    try {
      const errPayload = JSON.parse(e.data.payload.toString())
      throw boom.badData(errPayload.message)
    } catch (ex) {
      runtime.captureException(ex, {
        req: request,
        extra: {
          data: e.data,
          message: e.message
        }
      })
    }
    throw boom.badData()
  }
  const curried = handler(runtime)
  return curried(request, h)
}

v3.read = {
  handler: safetynetPassthrough(() => async () => {
    throw boom.resourceGone()
  })
}

v5.read = {
  handler: safetynetPassthrough(() => async () => {
    throw boom.resourceGone()
  })
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
  await runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('grants', debug),
      name: 'grants',
      property: 'grantId',
      empty: {
        token: '',

        // duplicated from "token" for unique
        grantId: '',
        // duplicated from "token" for filtering
        promotionId: '',

        status: '', // active, completed, expired

        batchId: '',
        timestamp: bson.Timestamp.ZERO
      },
      unique: [{ grantId: 1 }],
      others: [{ promotionId: 1 }, { altcurrency: 1 }, { probi: 1 },
        { status: 1 },
        { batchId: 1 }, { timestamp: 1 }]
    },
    {
      category: runtime.database.get('promotions', debug),
      name: 'promotions',
      property: 'promotionId',
      empty: {
        promotionId: '',
        priority: 99999,

        active: false,
        count: 0,

        batchId: '',
        timestamp: bson.Timestamp.ZERO,

        protocolVersion: 2
      },
      unique: [{ promotionId: 1 }],
      others: [{ active: 1 }, { count: 1 },
        { batchId: 1 }, { timestamp: 1 },
        { protocolVersion: 2 }]
    }
  ])

  await runtime.queue.create('redeem-report')
}
