const underscore = require('underscore')
const queries = {
  insert: `
INSERT INTO owners (
  owner,
  authorized,
  altcurrency,
  default_currency,
  visible,
  provider,
  parameters
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (owner)
DO
  UPDATE
    SET
      altcurrency = $3,
      default_currency = $4,
      visible = $5,
      provider = $6,
      parameters = $7;
`,
  updateByOwner: `
UPDATE owners
SET
  provider = $2,
  parameters = $3,
  altcurrency = $4,
  default_currency = $5,
  visible = $6
WHERE
  owner = $1;`,
  countByOwner: `
SELECT COUNT(*)
FROM owners
WHERE owner = $1;`,
  removeByOwner: `
DELETE FROM owners
WHERE owner = $1;`,
  readByOwner: `
SELECT *
FROM owners
WHERE owner = $1;`
}

module.exports = {
  queries,
  updatableParams,
  isVerified,
  create,
  updateByOwner,
  countByOwner,
  removeByOwner,
  readByOwner
}

function isVerified (owner) {
  const {
    provider,
    parameters
  } = owner
  return provider && parameters && parameters.access_token
}

function updatableParams (runtime, payload, entry = {}) {
  const altcurrency = getAltCurrency(runtime)
  const {
    provider,
    parameters,
    defaultCurrency = altcurrency,
    show_verification_status: visible
  } = payload

  return underscore.mapObject({
    provider,
    parameters,
    altcurrency,
    defaultCurrency,
    visible
  }, (value, key) => underscore.isUndefined(value) ? entry[key] : value)
}

function create (runtime, owner, payload, authorized = true) {
  const {
    altcurrency,
    defaultCurrency,
    visible,
    provider,
    parameters
  } = updatableParams(runtime, payload)

  return runtime.postgres.query(queries.insert, [
    owner,
    authorized,
    altcurrency,
    defaultCurrency,
    visible,
    provider,
    parameters
  ])
}

function getAltCurrency (runtime) {
  return runtime.config.altcurrency || 'BAT'
}

function updateByOwner (runtime, owner, entry, payload) {
  const {
    provider,
    parameters,
    altcurrency,
    defaultCurrency,
    visible
  } = updatableParams(runtime, payload, entry)

  return runtime.postgres.query(queries.updateByOwner, [
    owner,
    provider,
    parameters,
    altcurrency,
    defaultCurrency,
    visible
  ])
}

async function countByOwner (runtime, OWNER) {
  const result = await runtime.postgres.query(queries.countByOwner, [OWNER])
  return result.rows[0].count
}

async function removeByOwner (runtime, OWNER) {
  return runtime.postgres.query(queries.removeByOwner, [OWNER])
}

async function readByOwner (runtime, owner) {
  const {
    rows
  } = await runtime.postgres.query(queries.readByOwner, [
    owner
  ])
  return rows[0] || null
}
