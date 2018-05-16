'use strict'

const mongodb = require('mongodb')

const cleanMongoDb = async (db, collections) => {
  await collections.forEach(async (collection) => {
    await db.collection(collection).drop()
  })
}

const setupEyeshadeDb = async (t) => {
  const dbUri = `${process.env.BAT_MONGODB_URI}/eyeshade`
  t.context.db = await mongodb.MongoClient.connect(dbUri)
  await cleanMongoDb(t.context.db, ['owners', 'publishers', 'tokens'])
  t.context.owners = await t.context.db.collection('owners')
  t.context.publishers = await t.context.db.collection('publishers')
  t.context.tokens = await t.context.db.collection('tokens')
}

const assertChangeNumber = async (t, fnTestCase, fnGetValue, changeExpected, message) => {
  if (!fnGetValue || !fnTestCase) {
    throw new Error('fnGetValue and fnTestCase required')
  }
  const countBefore = await fnGetValue()
  await fnTestCase()
  const countAfter = await fnGetValue()
  t.is(countAfter, countBefore + changeExpected, message)
}

module.exports = { cleanMongoDb, setupEyeshadeDb, assertChangeNumber }
