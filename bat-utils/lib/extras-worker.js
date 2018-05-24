const dns = require('dns')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SDebug = require('sdebug')
const underscore = require('underscore')

const npminfo = require('../npminfo')

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
  const parent = options.parent || path.join(process.cwd(), 'src/workers')
  let errP, names
  let resolvers = underscore.uniq([ '8.8.8.8', '8.8.4.4' ].concat(dns.getServers()))

  const router = async (name) => {
    const module = require(path.join(parent, name))
    let working = module.workers

    const register = async (queue) => {
      if (entries[queue]) return debug('duplicate worker ' + queue)

      entries[queue] = true

      await runtime.queue.create(queue)
      runtime.queue.listen(queue, (err, debug, payload) => {
        if (err) {
          runtime.captureException(err)
          return debug(queue + ' listen', err)
        }

        runtime.newrelic.startBackgroundTransaction(name, () => {
          const transaction = runtime.newrelic.getTransaction()

          setTimeout(async () => {
            try { await working[queue](debug, runtime, payload) } catch (ex) {
              debug(queue, { payload: payload, err: ex, stack: ex.stack })
              runtime.newrelic.noticeError(ex, payload)
            }
            transaction.end()
          }, 100)
        })
      })

      listeners[name].push(queue)
    }

    if (typeof module.initialize === 'function') working = (await module.initialize(debug, runtime)) || working
    name = path.basename(name, '.js')
    listeners[name] = []

    for (let queue of underscore.keys(working)) { await register(queue) }
  }

  try {
    names = fs.readdirSync(parent)
  } catch (ex) {
    if (ex.code !== 'ENOENT') throw ex

    debug('no workers directory to scan')
    names = []
  }
  for (let name of names) {
    if ((name === 'index.js') || (name.indexOf('.test.js') !== -1) || (path.extname(name) !== '.js')) continue

    try {
      await router(name)
    } catch (ex) {
      errP = true
      debug('error loading workers for ' + name + ': ' + ex.toString())
      console.log(ex.stack)
    }
  }

  if (errP) process.exit(1)

  underscore.keys(listeners).sort().forEach((listener) => { debug(listener, listeners[listener].sort()) })

  dns.setServers(resolvers)
  debug('workers started',
    {
      resolvers: resolvers,
      env: underscore.pick(process.env, [ 'DEBUG', 'DYNO', 'NEW_RELIC_APP_NAME', 'NODE_ENV', 'BATUTIL_SPACES' ])
    })
  runtime.notify(debug, {
    text: os.hostname() + ' ' + npminfo.name + '@' + npminfo.version + ' started ' +
      (process.env.DYNO || 'worker') + '/' + options.id
  })
}

module.exports = Worker
