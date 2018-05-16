'use strict'

const mongodb = require('mongodb')

const cleanMongoDb = async (db, collections) => {
  await collections.forEach(async (collection) => {
    await db.collection(collection).remove()
  })
}

const connectEyeshadeDb = async (t) => {
  const dbUri = `${process.env.BAT_MONGODB_URI}/eyeshade`
  t.context.db = await mongodb.MongoClient.connect(dbUri)
}

const cleanEyeshadeDb = async (t) => {
  await cleanMongoDb(t.context.db, ['owners', 'publishers', 'tokens'])
  t.context.owners = await t.context.db.collection('owners')
  t.context.publishers = await t.context.db.collection('publishers')
  t.context.tokens = await t.context.db.collection('tokens')
}

module.exports = { cleanMongoDb, connectEyeshadeDb, cleanEyeshadeDb }
