#!/usr/bin/env node

/*
docker-compose -f docker-compose.yml run --rm -v $(pwd)/bin:/usr/src/app/bin -w /usr/src/app ledger-web bash

DEBUG=-* DATABASE_URL= MONGODB_URI= ./bin/migrate-wallets-to-grants.js
*/

const bson = require('bson')
const Postgres = require('bat-utils/lib/runtime-postgres')
const { MongoClient } = require('mongodb')

const insertStatement = `
insert into wallets(id, provider, provider_id, public_key, anonymous_address, provider_linking_id)
values($1, $2, $3, $4, $5, $6)
on conflict (id)
do update
set
    provider = $2,
    provider_id = $3,
    public_key = $4,
    anonymous_address = $5,
    provider_linking_id = $6;
`

async function main () {
  const {
    START_TIME: startTime = new Date(),
    MONGODB_URI: mongodbURI,
    DATABASE_URL: postgresURL
  } = process.env
  const postgres = new Postgres({ postgres: { url: postgresURL, roURL: false } })
  const { mongo: db, mongoClient } = await mongo({ url: mongodbURI })
  // wallets

  let counter = 0
  let complete = 0
  try {
    const wallets = db.collection('wallets')
    const maxObjectID = objectIdFromTimestamp(startTime)
    const query = {
      _id: {
        $lte: maxObjectID
      }
    }
    console.log('document count', await wallets.countDocuments(query))
    const batchSize = 1000
    const cursor = await wallets.find(query, {
      batchSize
    })
    const insertions = []
    await postgres.connect()
    const id = setInterval(() => (
      console.log('progress', counter, complete)
    ), 10000)
    let shouldContinue = false
    do {
      console.log('waiting for', insertions.length)
      await Promise.all(insertions)
      console.log('insertions.length', insertions.length)
      if (insertions.length) {
        throw new Error('too many to finish')
      }
      while (await cursor.hasNext()) {
        const wallet = await cursor.next()
        if (wallet.httpSigningPubKey) {
          const insert = postgres.query(insertStatement, [
            wallet.paymentId,
            wallet.provider,
            wallet.providerId,
            wallet.httpSigningPubKey,
            wallet.anonymousAddress || null,
            wallet.providerLinkingId || null
          ]).then(() => {
            insertions.splice(insertions.indexOf(insert), 1)
            complete += 1
          }).catch((err) => {
            console.log('erred', err)
            insertions.splice(insertions.indexOf(insert), 1)
            complete += 1
          })
          counter += 1
          insertions.push(insert)
          if (insertions.length >= batchSize) {
            break
          }
        } else {
          console.log('erred', wallet.paymentId)
        }
      }
      shouldContinue = insertions.length
    } while (shouldContinue)
    clearTimeout(id)
  } catch (err) {
    console.log(counter, complete)
    console.log(err)
  } finally {
    await mongoClient.close()
  }
}

main().then(result => {}).catch(e => {
  console.error(e)
})

function objectIdFromTimestamp (_timestamp) {
  // Convert string date to Date object (otherwise assume timestamp is a date)
  const timestamp = new Date(_timestamp)
  // Convert date object to hex seconds since Unix epoch
  var hexSeconds = Math.floor(timestamp / 1000).toString(16)
  // Create an ObjectId with that hex timestamp
  return bson.ObjectID.createFromHexString(hexSeconds + '0000000000000000')
}

function pathname (url) {
  const shardSplits = url.split(',')
  const shard = shardSplits[shardSplits.length - 1]
  const pathnames = shard.split('/')
  const pathnameAndAfter = pathnames[pathnames.length - 1]
  const noQuerySplit = pathnameAndAfter.split('?')
  return noQuerySplit[0]
}

function connectMongo (url) {
  return new Promise((resolve, reject) => {
    return MongoClient.connect(url, {
      useUnifiedTopology: true,
      useNewUrlParser: true
    }, (err, client) => {
      if (err) {
        reject(err)
      } else {
        resolve(client)
      }
    })
  })
}

async function mongo ({
  url,
  dbName
} = {}) {
  if (url) {
    let mongoClient = url
    let mongoDBName = dbName
    if (typeof url === 'string') {
      mongoClient = await connectMongo(url)
      mongoDBName = dbName || pathname(url)
    }
    const mongo = mongoClient.db(mongoDBName)
    return {
      mongo,
      mongoClient
    }
  }
}
