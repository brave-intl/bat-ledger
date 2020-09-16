const Postgres = require('./runtime-postgres')

module.exports = Promo

function Promo (config, runtime) {
  // disallow schema version check on external service
  config.promo.schemaVersion = false
  return new Postgres({
    postgres: config.promo
  }, runtime)
}
