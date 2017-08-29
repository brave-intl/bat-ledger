const underscore = require('underscore')

const utilities = require('.')
const config = require('./config/config.' + (process.env.NODE_ENV || 'development') + '.js')
const options = {
  routes: utilities.hapi.controllers.index,
  controllers: underscore.omit(utilities.hapi.controllers, [ 'index' ]),
  module: module
}

process.env.DEBUG = '*,-mongo:*,mongo:queries'
utilities.hapi.server(options, new utilities.Runtime(config))
