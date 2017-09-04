const mongodb = require('mongodb')
const GridStore = mongodb.GridStore
const GridStream = require('gridfs-stream')
const monk = require('monk')
const SDebug = require('sdebug')
const debug = new SDebug('database')
const underscore = require('underscore')

const Database = function (config, runtime) {
  if (!(this instanceof Database)) return new Database(config, runtime)

  if (!config.database) throw new Error('config.database undefined')

  if (config.database.mongo) config.database = config.database.mongo
  this.config = config.database
  this.db = monk(this.config, { debug: debug }, (err, db) => {
    if (!err) return

    debug('database', { message: err.message })
    throw err
  })
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
  const reports = this.db.get('fs.files', debug)
  let entries, names

  await reports.index({ uploadDate: 1 }, { unique: false })
  entries = await reports.find({ uploadDate: { $lt: new Date(timestamp) } })
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

  ndebug.initial = debug.initial

  return this.db.get(collection, { cache: false, debug: ndebug })
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
        await category.index(index, { unique: true })
      });

      (entry.others || []).forEach(async (index) => {
        await category.index(index, { unique: false })
      });

      (entry.raw || []).forEach(async (index) => {
        await category.index(index)
      })
    } catch (ex) {
      debug('unable to create ' + entry.name + ' ' + entry.property + ' index', ex)
    }
  })
}

module.exports = Database
