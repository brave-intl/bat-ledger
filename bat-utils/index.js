
const hapi = require('./boot-hapi')
const extras = require('./boot-extras')
const runtime = require('./boot-runtime')
module.exports = {
  hapi,
  Hapi: hapi,
  extras,
  Extras: extras,
  runtime,
  Runtime: runtime
}
