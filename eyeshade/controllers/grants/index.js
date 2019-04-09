
const braveHapi = require('bat-utils/lib/extras-hapi')
const v1 = require('./v1')

const routes = [
  braveHapi.routes.async().path('/v1/grants/{paymentId}').whitelist().config(v1.getGrants)
]

module.exports = {
  routes
}
