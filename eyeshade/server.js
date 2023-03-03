import { Runtime } from 'bat-utils/index.js'
import * as bootHapi from 'bat-utils/boot-hapi.js'

import config from '../config.js'
import * as accountsController from './controllers/accounts.js'
import * as publishersController from './controllers/publishers.js'
import * as referralsController from './controllers/referrals.js'
import * as statsController from './controllers/stats.js'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import { getCurrent } from './migrations/current.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)

if (!process.env.BATUTIL_SPACES) {
  process.env.BATUTIL_SPACES = '*,-extras.worker'
}
const { controllers, server } = bootHapi

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
  // module,
  headersP: false,
  remoteP: true
}

config.postgres.schemaVersion = getCurrent()

export default server(options, new Runtime(config))
