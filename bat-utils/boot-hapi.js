const hapiControllersIndex = require('./lib/hapi-controllers-index')
const hapiServer = require('./lib/hapi-server')

const controllers = {
  index: hapiControllersIndex
}

module.exports = {
  server: hapiServer,
  controllers
}
