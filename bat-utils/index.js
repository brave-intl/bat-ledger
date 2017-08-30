const path = require('path')

const glob = require('glob')
const underscore = require('underscore')

const cwd = process.cwd()
const prefix = 'boot-'

const parent = path.join(cwd, '..')
const npminfo = require(path.join((underscore.last(parent.split(path.sep)) !== 'node_modules') ? cwd : path.join(parent, '..'),
    'package'))
if (process.env.SERVICE) npminfo.name = process.env.SERVICE
process.npminfo = underscore.pick(npminfo,
                                  [ 'name', 'version', 'description', 'author', 'license', 'bugs', 'homepage', 'dependencies' ])

const namespaces = (process.env.BATUTIL_SPACES || '*').split(/[\s,]+/)
const utilspaces = { ignores: [], require: [] }
namespaces.forEach((namespace) => {
  namespace = namespace.replace(/\*/g, '.*?')
  if (namespace[0] === '-') {
    utilspaces.ignores.push(new RegExp('^' + namespace.substr(1) + '$'))
  } else {
    utilspaces.require.push(new RegExp('^' + namespace + '$'))
  }
})
process.batutil = {
  enabled: (namespace) => {
    const memberP = (member) => {
      let result = false

      utilspaces[member].forEach((entry) => { if (entry.test(namespace)) result = true })
      return result
    }

    if (memberP('ignores')) return false

    return memberP('require')
  }
}

glob.sync(prefix + '*.js', { cwd: __dirname }).forEach((file) => {
  const key = path.basename(file.substring(prefix.length), '.js')

  if (!process.batutil.enabled(key)) return

  module.exports[key] = module.exports[key.charAt(0).toUpperCase() + key.slice(1)] = require(path.join(__dirname, file))
})
