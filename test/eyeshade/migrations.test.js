'use strict'

import { serial as test } from 'ava'
import Runtime from 'bat-utils/boot-runtime'
import {
  createdTimestamp
} from 'bat-utils/lib/extras-utils'
import owners from '../../eyeshade/lib/owners'
import migrateOwnersRunner from '../../bin/migrate-owners-runner'
import {
  ObjectId,
  Timestamp
} from 'bson'
import {
  dbUri,
  publisherId
} from '../utils'

const {
  BAT_POSTGRES_URL
} = process.env

const mongoURL = dbUri('eyeshade')
const runtime = new Runtime({
  database: mongoURL,
  postgres: {
    url: BAT_POSTGRES_URL
  }
})

test('migrations table is up-to-date', async t => {
  const latestInMigrationsTable = (await runtime.postgres.query('select id from migrations order by id desc limit 1;', [])).rows[0].id
  const latestInMigrationsFolder = require('../../eyeshade/migrations/current')

  t.true(latestInMigrationsTable === latestInMigrationsFolder)
})

test('owners collection can be migrated to postgres', async (t) => {
  t.plan(6)
  let ownerList
  const ownersCollection = runtime.database.get('owners', () => {})
  await ownersCollection.remove({})
  // find any existing owners
  ownerList = await ownersCollection.find({})
  t.deepEqual(ownerList, [], 'no owners exist')
  // generate new mongo owners
  const owner1 = generateMongoOwner()
  const owner2 = generateMongoOwner()
  // insert into mongo
  const opts = { upsert: true }
  await ownersCollection.update({ owner: owner1.owner }, { $set: owner1 }, opts)
  await ownersCollection.update({ owner: owner2.owner }, { $set: owner2 }, opts)
  // check that they were inserted
  ownerList = await ownersCollection.find({})
  t.deepEqual(ownerList, [owner1, owner2], '2 owners have been inserted')
  // check that they do not yet exist in postgres
  const pgOwner1 = await owners.readByOwner(runtime, owner1.owner)
  const pgOwner2 = await owners.readByOwner(runtime, owner2.owner)
  t.is(pgOwner1, null, 'owner doesn\'t exist yet')
  t.is(pgOwner2, null, 'owner doesn\'t exist yet')
  // run migration
  await migrateOwnersRunner({
    mongo: mongoURL,
    postgres: BAT_POSTGRES_URL
  })
  // get pg owners
  const pgAfterOwner1 = await owners.readByOwner(runtime, owner1.owner)
  const pgAfterOwner2 = await owners.readByOwner(runtime, owner2.owner)
  // check against original
  const mongoAfterOwner1 = convertMongo2Pg(owner1)
  t.deepEqual(pgAfterOwner1, mongoAfterOwner1, 'owner 1 was transferred')
  const mongoAfterOwner2 = convertMongo2Pg(owner2)
  t.deepEqual(pgAfterOwner2, mongoAfterOwner2, 'owner 2 was transferred')
})

function convertMongo2Pg (owner) {
  return {
    altcurrency: owner.altcurrency,
    authorized: owner.authorized,
    created_at: new Date(createdTimestamp(owner._id)),
    default_currency: owner.defaultCurrency,
    owner: owner.owner,
    parameters: owner.parameters,
    provider: owner.provider,
    visible: owner.visible,
    updated_at: new Date(owner.timestamp.toInt() * 1000)
  }
}

function generateMongoOwner (extension = {}) {
  const owner = publisherId()
  const parameters = {
    arbitrary: 'data',
    goes: 'here'
  }
  const defaultCurrency = 'anything'
  const ownerData = {
    owner,
    provider: 'uphold',
    defaultCurrency,
    parameters,
    visible: true,
    verified: true,
    authorized: true,
    altcurrency: 'BAT',
    authority: 'uphold',
    _id: createDate(),
    timestamp: updateTimestamp(),
    info: {
      email: 'random@anemail.com'
    }
  }
  return Object.assign(ownerData, extension)
}

function updateTimestamp () {
  return Timestamp.fromBits(1543674327 - parseInt(Math.random() * 1000, 10), 1)
}

function createDate () {
  const rando = parseInt((Math.random() * 900000) + 100000, 10)
  const passed = `5c0298c1ee3212b7ed${rando}`
  return ObjectId.createFromHexString(passed)
}
