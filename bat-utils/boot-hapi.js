
const hapiAuthWhitelist = require('./lib/hapi-auth-whitelist')
const hapiControllersIndex = require('./lib/hapi-controllers-index')
const hapiServer = require('./lib/hapi-server')

const controllers = {
  index: hapiControllersIndex
}
const auth = {
  whitelist: hapiAuthWhitelist
}

module.exports = {
  server: hapiServer,
  controllers,
  auth
}
