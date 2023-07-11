import SDebug from 'bat-utils/lib/sdebug.js'
import pg from 'pg'
import _ from 'underscore'
const Pool = pg.Pool
const debug = new SDebug('postgres')

const Postgres = function (config, runtime) {
  if (!(this instanceof Postgres)) return new Postgres(config, runtime)

  if (!config.postgres) return
  this.rwPool = new Pool(config.postgres)

  this.pool().on('error', (err) => {
    debug('postgres', { message: err })
    throw err
  })

  if (config.postgresRO) {
    this.roPool = new Pool(config.postgresRO)

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
  query: async function (text, params = [], readOnly, logs) {
    let client = null
    if (_.isBoolean(readOnly)) {
      client = this.pool(readOnly)
    } else {
      // passed the pool / client
      client = readOnly || this.pool() // nothing was passed so assume rw
    }
    return runQuery(text, params, client, logs)
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

export default Postgres
