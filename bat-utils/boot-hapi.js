import hapiControllersIndex from './lib/hapi-controllers-index.js'
import hapiServer from './lib/hapi-server.js'

const controllers = {
  index: hapiControllersIndex
}

export {
  hapiServer as server,
  controllers
}
