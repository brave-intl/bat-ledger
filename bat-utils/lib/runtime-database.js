const bson = require('bson')
const mongodb = require('mongodb')
const GridStore = mongodb.GridStore
const GridStream = require('gridfs-stream')
const Logger = mongodb.Logger
const monk = require('monk')
const SDebug = require('sdebug')
const debug = new SDebug('database')
const stringify = require('json-stringify-safe')
const underscore = require('underscore')

const Database = function (config, runtime) {
  if (!(this instanceof Database)) return new Database(config, runtime)

  if (!config.database) return

  if (config.database.mongo) config.database = config.database.mongo
  this.config = config.database
  this.db = monk(this.config, (err, db) => {
    if (!err) return

    debug('database', { message: err.message })
    throw err
  })

  Logger.setCurrentLogger((msg, context) => {
    if (context.type !== 'debug') debug(context.className.toLowerCase(), context.message)
  })
  this.db.addMiddleware(this.middleware)
}

Database.prototype.middleware = (context) => {
  const collection = context.collection

  return (next) => {
    return (args, method) => {
      const ndebug = (collection && collection._debug) || debug
      const params = args.query || (args.col && args.col.s && args.col.s.name) || underscore.keys(args)
      let prefix = method
      let query = stringify(params)

      if (collection) {
        prefix = collection.name + '.' + prefix
        if (params === collection.name) query = ''
      }
      if (query) prefix += ' ' + query

      return next(args, method).then((result) => {
        let values

        if (result) {
          if (result._id) values = result._id
          else if (Array.isArray(result) && (typeof result.length === 'number')) {
            values = []
            result.forEach((entry) => { if (entry._id) values.push(entry._id) })
            if (result.length === values.length) values = stringify(values)
            else values = result.length + ' result' + (result.length === 1 ? 's' : '')
          }
        }

        ndebug('%s: %s', prefix, (values || stringify(result)))
        return result
      })
    }
  }
}

Database.prototype.file = async function (filename, mode, options) {
  options = underscore.extend(options || {}, { safe: true })

  if (mode !== 'r') return (new GridStore(this.db._db, filename, mode, options).open())

  return new Promise((resolve, reject) => {
    GridStore.exist(this.db._db, filename, (err, result) => {
      let gridStore

      if (err) return reject(err)

      if (!result) return resolve(null)

      gridStore = new GridStore(this.db._db, filename, mode, options)
      gridStore.open((err, result) => {
        if (err) return reject(err)

        resolve(result)
      })
    })
  })
}

Database.prototype.purgeSince = async function (debug, runtime, timestamp) {
  const reports = this.get('fs.files', debug)
  let entries, names

  await reports.createIndex({ uploadDate: 1 }, { unique: false })

  entries = await reports.find({
    _id: { $lte: bson.ObjectId(Math.floor(timestamp / 1000.0).toString(16) + '0000000000000000') }
  })
  debug('purgeSince', { count: entries.length })

  if (entries.length === 0) return

  names = underscore.map(entries, (entry) => { return entry._id })
  return new Promise((resolve, reject) => {
    GridStore.unlink(this.db._db, names, (err) => {
      if (err) return debug('purgeSince', err)

      resolve()
    })
  })
}

Database.prototype.source = function (options) {
  return GridStream(this.db._db, mongodb).createReadStream(options)
}

Database.prototype.get = function (collection, debug) {
  const ndebug = new SDebug('monk:queries')
  const result = this.db.get(collection, { cache: false })

  ndebug.initial = debug.initial
  result._debug = ndebug

  return result
}

Database.prototype.checkIndices = async function (debug, entries) {
  entries.forEach(async (entry) => {
    const category = entry.category
    let doneP, indices

    try { indices = await category.indexes() } catch (ex) { indices = [] }
    doneP = underscore.keys(indices).indexOf(entry.property + '_1') !== -1

    debug(entry.name + ' indices ' + (doneP ? 'already' : 'being') + ' created')
    if (doneP) return

    try {
      if (indices.length === 0) { await category.insert(entry.empty) }

      (entry.unique || []).forEach(async (index) => {
        await category.createIndex(index, { unique: true })
      });

      (entry.others || []).forEach(async (index) => {
        await category.createIndex(index, { unique: false })
      });

      (entry.raw || []).forEach(async (index) => {
        await category.createIndex(index)
      })
    } catch (ex) {
      debug('unable to create ' + entry.name + ' ' + entry.property + ' index', ex)
    }
  })
}

module.exports = Database
