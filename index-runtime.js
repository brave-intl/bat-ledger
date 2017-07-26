const path = require('path')

const glob = require('glob')
const underscore = require('underscore')

let Runtime = function (config) {
  if (!(this instanceof Runtime)) return new Runtime(config)

  const cwd = path.join(__dirname, 'lib')
  const prefix = 'runtime-'

  if (!config) config = process.env.NODE_ENV || 'development'
  if (typeof config === 'string') config = require(path.join(process.cwd(), 'config', 'config.' + config + '.js'))

  underscore.keys(config).forEach((key) => {
    let m = config[key]
    if (typeof m === 'undefined') return

    underscore.keys(m).forEach((k) => {
      if (typeof m[k] === 'undefined') throw new Error('config.' + key + '.' + k + ': undefined')

      if ((typeof m[k] !== 'number') && (typeof m[k] !== 'boolean') && (typeof m[k] !== 'object') && (!m[k])) {
        throw new Error('config.' + key + '.' + k + ': empty')
      }
    })
  })

  underscore.defaults(this, {
    config: config,
    login: config.login,
    notify: (debug, payload) => { debug('notify', 'slack webhook not configured') }
  })

  glob.sync(prefix + '*.js', { cwd: cwd }).forEach((file) => {
    let key = path.basename(file.substring(prefix.length), '.js')

    if (config[key]) this[key] = new (require(path.join(cwd, file)))(config, this)
  })
}

module.exports = Runtime
