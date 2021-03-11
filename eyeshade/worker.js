const dotenv = require('dotenv')
const utils = require('bat-utils')

const config = require('../config.js')

const reportsWorker = require('./workers/reports')
const surveyorsWorker = require('./workers/surveyors')

const {
  Runtime,
  extras
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

const parentModules = [
  reportsWorker,
  surveyorsWorker
]

const options = {
  parentModules,
  module: module
}

config.cache = false
config.queue = true

const runtime = new Runtime(config)
extras.worker(options, runtime)
