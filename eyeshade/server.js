import { hapi, Runtime } from 'bat-utils/index.js'

import * as config from '../config.js'
import * as accountsController from './controllers/accounts.js'
import * as publishersController from './controllers/publishers.js'
import * as referralsController from './controllers/referrals.js'
import * as statsController from './controllers/stats.js'
import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-extras.worker'
}
const { controllers, server } = hapi

Runtime.newrelic.setupNewrelic(config, __filename)

const parentModules = [
  accountsController,
  publishersController,
  referralsController,
  statsController
]

const options = {
  port: process.env.PORT,
  parentModules,
  routes: controllers.index,
  controllers,
  module,
  headersP: false,
  remoteP: true
}

config.postgres.schemaVersion = require('./migrations/current')

export default server(options, new Runtime(config))
