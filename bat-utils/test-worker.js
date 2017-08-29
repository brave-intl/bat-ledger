const utilities = require('.')
const config = require('./config/config.' + (process.env.NODE_ENV || 'development') + '.js')
const options = {
  module: module
}

process.env.DEBUG = '*,-mongo:*,mongo:queries'
utilities.extras.worker(options, new utilities.Runtime(config))
