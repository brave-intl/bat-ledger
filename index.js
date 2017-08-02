const path = require('path')

const glob = require('glob')
const underscore = require('underscore')

const cwd = process.cwd()
const prefix = 'boot-'

const parent = path.join(cwd, '..')
console.log(underscore.last(parent.split(path.sep)))
const npminfo = require(path.join((underscore.last(parent.split(path.sep)) !== 'node_modules') ? cwd : path.join(parent, '..'),
    'package'))
process.npminfo = underscore.pick(npminfo,
                                  [ 'name', 'version', 'description', 'author', 'license', 'bugs', 'homepage', 'dependencies' ])

glob.sync(prefix + '*.js', { cwd: __dirname }).forEach((file) => {
  const key = path.basename(file.substring(prefix.length), '.js')

  module.exports[key] = module.exports[key.charAt(0).toUpperCase() + key.slice(1)] = require(path.join(__dirname, file))
})
