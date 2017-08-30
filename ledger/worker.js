require('dotenv').config()
if (!process.env.BATUTIL_SPACES) process.env.BATUTIL_SPACES = '*,-hapi'

const path = require('path')

const utils = require('bat-utils')

const config = require('../config.js')
const options = {
  parent: path.join(__dirname, 'workers'),
  module: module
}

utils.extras.worker(options, new utils.Runtime(config))
