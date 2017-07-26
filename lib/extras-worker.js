const fs = require('fs')
const path = require('path')

const SDebug = require('sdebug')
const underscore = require('underscore')

const Worker = async (options, runtime) => {
  const debug = new SDebug('worker')

  if (!runtime) {
    runtime = options
    options = {}
  }
  underscore.defaults(options, { id: 1 })

  debug.initialize({ worker: { id: options.id } })

  if (process.env.NODE_ENV !== 'production') {
    process.on('warning', (warning) => {
      if (warning.name === 'DeprecationWarning') return

      debug('warning', underscore.pick(warning, [ 'name', 'message', 'stack' ]))
    })
  }

  const entries = {}
  const listeners = {}
  const parent = path.join(process.cwd(), 'workers')
  let errP, i, names

  const router = async (name) => {
    const module = require(path.join(parent, name))
    let i, key, names
    let working = module.workers

    if (typeof module.initialize === 'function') working = (await module.initialize(debug, runtime)) || working
    name = path.basename(name, '.js')
    listeners[name] = []

    names = underscore.keys(working)
    for (i = names.length - 1; i >= 0; i--) {
      key = names[i]
      if (entries[key]) {
        debug('duplicate worker ' + key)
        continue
      }

      await runtime.queue.create(key)
      runtime.queue.listen(key, async (err, debug, payload) => {
        if (err) {
          runtime.notify(debug, { text: key + ' listen error: ' + err.toString() })
          return debug(key + ' listen', err)
        }

        try { await working[key](debug, runtime, payload) } catch (ex) {
          debug(key, { payload: payload, err: ex, stack: ex.stack })
        }
      })

      listeners[name].push(key)
    }
  }

  try {
    names = fs.readdirSync(parent)
  } catch (ex) {
    if (ex.code !== 'ENOENT') throw ex

    debug('no workers directory to scan')
    names = []
  }
  for (i = names.length - 1; i >= 0; i--) {
    if ((names[i] === 'index.js') || (path.extname(names[i]) !== '.js')) continue

    try {
      await router(names[i])
    } catch (ex) {
      debug('error loading workers for ' + names[i] + ': ' + ex.toString())
      console.log(ex.stack)
      process.exit(1)
    }
  }

  if (errP) process.exit(1)

  underscore.keys(listeners).sort().forEach((listener) => { debug(listener, listeners[listener].sort()) })
}

module.exports = Worker
