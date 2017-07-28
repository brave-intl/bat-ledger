const path = require('path')

const glob = require('glob')
const SDebug = require('sdebug')
const underscore = require('underscore')

const cwd = path.join(__dirname, 'lib')
const debug = new SDebug('boot')
const prefix = 'hapi-'

glob.sync(prefix + '*.js', { cwd: cwd }).forEach((file) => {
  let base = module.exports
  let key = path.basename(file.substring(prefix.length), '.js')
  let parent = ''
  let parts = key.split('-')

  while (parts.length > 1) {
    key = parts[0]
    if (!base[key]) base[key] = {}
    base = base[key]
    parent += key + '.'

    parts = underscore.rest(parts)
    key = parts[0]
  }

  base[key] = require(path.join(cwd, file))
  debug('hapi', 'loaded ' + parent + key)
})
