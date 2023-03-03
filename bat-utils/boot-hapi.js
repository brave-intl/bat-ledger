import * as hapiControllersIndex from './lib/hapi-controllers-index.js'
import * as hapiServer from './lib/hapi-server.js'

const controllers = {
  index: hapiControllersIndex
}

export default {
  server: hapiServer,
  controllers
}
