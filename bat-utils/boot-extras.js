const path = require('path')

const glob = require('glob')
const SDebug = require('sdebug')

const cwd = path.join(__dirname, 'lib')
const debug = new SDebug('boot')
const prefix = 'extras-'

glob.sync(prefix + '*.js', { cwd: cwd }).forEach((file) => {
  if (file.indexOf('.test.js') !== -1) return

  const key = path.basename(file.substring(prefix.length), '.js')
  if (!process.batutil.enabled('util.' + key)) return

  module.exports[key] = require(path.join(cwd, file))
  debug('extras', 'loaded ' + key)
})
