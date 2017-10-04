require('dotenv').config()
if (!process.env.BATUTIL_SPACES) process.env.BATUTIL_SPACES = '*,-extras.worker'

const path = require('path')

const utils = require('bat-utils')

const config = require('../config.js')
const options = {
  parent: path.join(__dirname, 'controllers'),
  routes: utils.hapi.controllers.index,
  controllers: utils.hapi.controllers,
  module: module
}

config.cache = false

module.exports = utils.hapi.server(options, new utils.Runtime(config))
