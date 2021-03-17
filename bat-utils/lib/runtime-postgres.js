const SDebug = require('sdebug')
const pg = require('pg')
const _ = require('underscore')
const Pool = pg.Pool
const debug = new SDebug('postgres')

const Postgres = function (config, runtime) {
  if (!(this instanceof Postgres)) return new Postgres(config, runtime)

  if (!config.postgres) return
  this.rwPool = new Pool({
    connectionString: config.postgres.url,
    ssl: process.env.NODE_ENV === 'production'
  })

  this.pool().on('error', (err) => {
    debug('postgres', { message: err })
    throw err
  })

  if (config.postgres.roURL) {
    this.roPool = new Pool({
      connectionString: config.postgres.roURL,
      ssl: process.env.NODE_ENV === 'production'
    })

    this.pool(true).on('error', (err) => {
      debug('postgres', { message: err })
      throw err
    })
  }

  if (config.postgres.schemaVersionCheck) {
    this.pool(true).query('select id from migrations order by id desc limit 1')
      .then((resp) => {
        if (resp.rowCount !== 1) {
          throw Error('db has not been initialized')
        }
        const currentVersion = resp.rows[0].id
        const targetVersion = config.postgres.schemaVersion
        if (targetVersion !== currentVersion) {
          throw Error(`db schema is too old, saw ${currentVersion} expected ${targetVersion}`)
        }
      })
  }
}

Postgres.prototype = {
  quit: function () {
    return Promise.all([
      this.roPool && this.roPool.end(),
      this.rwPool && this.rwPool.end()
    ])
  },
  connect: function (readOnly) {
    return this.pool(readOnly).connect()
  },
  pool: function (readOnly) {
    return (readOnly ? this.roPool : this.rwPool) || this.rwPool
  },
  query: async function (text, params = [], readOnly) {
    let client = null
    if (_.isBoolean(readOnly)) {
      client = this.pool(readOnly)
    } else {
      // passed the pool / client
      client = readOnly || this.pool() // nothing was passed so assume rw
    }
    return runQuery(text, params, client)
  },
  insert: async function (text, params = [], options) {
    const { client = this.pool(), returnResults = false } = options
    let query = text.trim()
    let args = params
    const values = 'values'
    if (query.slice(query.length - values.length).toLowerCase() === values) {
      // append row placeholders to the query
      const preppedParams = this.prepInsert(params)
      query = `${query} ${preppedParams.map((row, rowIndex) =>
        `( ${row.map((_, argIndex) => `$${1 + argIndex + (row.length * rowIndex)}`).join(', ')} )`
      ).join(',\n')}${returnResults ? '\nreturning *' : ''}`
      // flatten the rows into a single array
      args = [].concat.apply([], preppedParams)
    }
    return runQuery(query, args, client, {
      text,
      length: params.length
    })
  },
  prepInsert: function (rows) {
    const filtered = rows.filter((row) => row)
    const longest = filtered.reduce((memo, row) => Math.max(row.length, memo), 0)
    // the inverse of [...new Array(x)]
    return filtered.map((row) => row.reduce((newRow, arg, index) => {
      newRow[index] = arg
      return newRow
    }, new Array(longest)))
  },
  transact: async function (fn) {
    const client = await this.connect()
    let res
    try {
      await client.query('BEGIN')
      res = await fn(client)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    return res
  }
}

async function runQuery (query, args, client, logs = {}) {
  let ret = null
  try {
    const start = Date.now()
    ret = await client.query(query, args)
    const duration = Date.now() - start
    debug('executed query %o', Object.assign({ text: query, duration, rows: ret.rowCount }, logs))
  } catch (err) {
    debug('failed query %o', { text: query, err })
    throw err
  }
  return ret
}

module.exports = Postgres
