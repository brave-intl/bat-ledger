
const hapiAuthWhitelist = require('./lib/hapi-auth-whitelist')
const hapiControllersIndex = require('./lib/hapi-controllers-index')
const hapiControllersPing = require('./lib/hapi-controllers-ping')
const hapiServer = require('./lib/hapi-server')

const controllers = {
  index: hapiControllersIndex,
  ping: hapiControllersPing
}
const auth = {
  whitelist: hapiAuthWhitelist
}

module.exports = {
  server: hapiServer,
  controllers,
  auth
}
