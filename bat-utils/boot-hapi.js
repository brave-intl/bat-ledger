
const hapiAuthWhitelist = require('./lib/hapi-auth-whitelist')
const hapiControllersIndex = require('./lib/hapi-controllers-index')
const hapiControllersLogin = require('./lib/hapi-controllers-login')
const hapiControllersPing = require('./lib/hapi-controllers-ping')
const hapiServer = require('./lib/hapi-server')

const controllers = {
  index: hapiControllersIndex,
  login: hapiControllersLogin,
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
