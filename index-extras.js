const path = require('path')

const glob = require('glob')

const cwd = path.join(__dirname, 'lib')
const prefix = 'extras-'

glob.sync(prefix + '*.js', { cwd: cwd }).forEach((file) => {
  const key = path.basename(file.substring(prefix.length), '.js')

  module.exports[key] = require(path.join(cwd, file))
})
