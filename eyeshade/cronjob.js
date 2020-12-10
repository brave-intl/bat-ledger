const dotenv = require('dotenv')
const utils = require('$/bat-utils')
const SDebug = require('sdebug')
const config = require('../config.js')

const surveyorsWorker = require('./workers/surveyors')
const debug = SDebug('cronjob')
const {
  Runtime
} = utils

dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-hapi'
}

Runtime.newrelic.setupNewrelic(config, __filename)

config.cache = false

const runtime = new Runtime(config)
surveyorsWorker.initialize(debug, runtime)
