const fs = require('fs')
const path = require('path')

const underscore = require('underscore')

var exports = {}

exports.routes = async (debug, runtime, controllers) => {
  const entries = {}
  const parent = path.join(process.cwd(), 'src/controllers')
  const routes = [
    { method: 'GET',
      path: '/',
      config: { handler: (request, reply) => { reply('ack.') } }
    }
  ]
  let errP, i, names

  const router = async (module) => {
    let routing = module.routes

    if (typeof module.initialize === 'function') routing = (await module.initialize(debug, runtime)) || routing

    if (!underscore.isArray(routing)) return []

    routing.forEach(route => {
      const entry = route(runtime)
      const key = entry.method + ' ' + entry.path

      if (((typeof entry.config.auth !== 'undefined') || (entry.path.indexOf('/logout') !== -1)) && (!runtime.login)) {
        debug('no authentication configured for route ' + key)
        return
      }

      if (entries[key]) { debug('duplicate route ' + key) } else { entries[key] = true }
      routes.push(entry)
    })
  }

  if (controllers) {
    names = underscore.keys(controllers)

    for (i = names.length - 1; i >= 0; i--) {
      try {
        await router(controllers[names[i]])
      } catch (ex) {
        errP = true
        debug('error loading routes for built-in controller' + names[i] + ': ' + ex.toString())
        console.log(ex.stack)
      }
    }
  }

  try {
    names = fs.readdirSync(parent)
  } catch (ex) {
    if (ex.code !== 'ENOENT') throw ex

    debug('no controllers directory to scan')
    names = []
  }
  for (i = names.length - 1; i >= 0; i--) {
    if ((names[i] === 'index.js') || (path.extname(names[i]) !== '.js')) continue

    try {
      const module = require(path.join(parent, names[i]))
      await router(module)
    } catch (ex) {
      errP = true
      debug('error loading routes for module controller ' + names[i] + ': ' + ex.toString())
      console.log(ex.stack)
    }
  }

  if (errP) process.exit(1)

  return routes
}

module.exports = exports
