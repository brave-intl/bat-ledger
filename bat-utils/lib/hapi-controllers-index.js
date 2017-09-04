const fs = require('fs')
const path = require('path')

const underscore = require('underscore')

var exports = {}

exports.routes = async (debug, runtime, options) => {
  const entries = {}
  const parent = options.parent || path.join(process.cwd(), 'src/controllers')
  const routes = [
    { method: 'GET',
      path: '/',
      config: { handler: (request, reply) => { reply('ack.') } }
    }
  ]
  let errP, names

  const router = async (module) => {
    let routing = module.routes

    if (typeof module.initialize === 'function') routing = (await module.initialize(debug, runtime)) || routing

    if (!Array.isArray(routing)) return []

    routing.forEach(route => {
      const entry = route(runtime)
      const key = entry.method + ' ' + entry.path

      if (entries[key]) { debug('duplicate route ' + key) } else { entries[key] = true }
      routes.push(entry)
    })
  }

  if (options.controllers) {
    names = underscore.without(underscore.keys(options.controllers), 'index')

    for (let name of names) {
      try {
        await router(options.controllers[name])
      } catch (ex) {
        errP = true
        debug('error loading routes for built-in controller' + name + ': ' + ex.toString())
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
  for (let name of names) {
    if ((name === 'index.js') || (path.extname(name) !== '.js')) continue

    try {
      const module = require(path.join(parent, name))
      await router(module)
    } catch (ex) {
      errP = true
      debug('error loading routes for module controller ' + name + ': ' + ex.toString())
      console.log(ex.stack)
    }
  }

  if (errP) process.exit(1)

  return routes
}

module.exports = exports
