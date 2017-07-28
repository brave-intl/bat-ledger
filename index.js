const path = require('path')

const glob = require('glob')
const underscore = require('underscore')

const cwd = __dirname
const prefix = 'boot-'

const parent = path.join(cwd, '..')
const npminfo = require(path.join((parent !== 'node_modules') ? cwd : path.join(parent, '..'), 'package'))
process.npminfo = underscore.pick(npminfo,
                                  [ 'name', 'version', 'description', 'author', 'license', 'bugs', 'homepage', 'dependencies' ])

glob.sync(prefix + '*.js', { cwd: cwd }).forEach((file) => {
  const key = path.basename(file.substring(prefix.length), '.js')

  module.exports[key] = module.exports[key.charAt(0).toUpperCase() + key.slice(1)] = require(path.join(cwd, file))
})
