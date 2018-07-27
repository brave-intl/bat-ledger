
const mongodb = require('mongodb')
const BigNumber = require('bignumber.js')
const Postgres = require('bat-utils/lib/runtime-postgres')
const {
  createdTimestamp,
  mongoUri
} = require('bat-utils/lib/extras-utils')

const postgres = new Postgres({
  postgres: {
    settings: {}
  }
})

const SETTLEMENTS = 'settlements'
const VOTING = 'voting'
const DB = 'eyeshade'

init().catch((err) => {
  console.log(err)
}).then(() => {
  process.exit(0)
})

async function init () {
  console.log('connecting')
  const connection = await connect()
  console.log('connected')
  const mongo = connection.db(DB)
  const settlements = await getAllDocuments(mongo, SETTLEMENTS, {
    owner: { $ne: '' },
    probi: { $gt: 0 }
  })
  const referrals = await aggregateReferrals(mongo)
  const voting = await getAllVotes(mongo)
  console.log('creating transactions')
  const queries = JSON.stringify({
    settlements: settlements.length,
    referrals: referrals.length,
    voting: voting.length
  }, null, 2)
  console.log(`queries\n${queries}`)
  const settled = settlements.reduce(gather('settlement'), [])
  const referred = referrals.reduce(gather('referral'), [])
  const voted = voting.reduce(gather('vote'), [])
  const transactions = JSON.stringify({
    settlements: settled.length,
    referrals: referred.length,
    voting: voted.length
  }, null, 2)
  console.log(`transactions\n${transactions}`)
  console.log('queries started')
  await postgres.insertTransactions(settled)
  console.log('settlements finished')
  await postgres.insertTransactions(referred)
  console.log('referrals finished')
  await postgres.insertTransactions(voted)
  console.log('votes finished')
  console.log('queries finished')
  await connection.close()
  console.log('connection closed')
}

function gather (key) {
  return (memo, item) => {
    const { _id, firstId } = item
    const createdAt = firstId || _id
    item.createdAt = new Date(createdTimestamp(createdAt))
    memo.push.apply(memo, postgres.transactionsFrom(key, item))
    return memo
  }
}

async function getAllVotes (mongo) {
  const votes = await mongo.collection(VOTING).aggregate([{
    $match: {
      probi: { $gt: 0 },
      exclude: false
    }
  }, {
    $group: {
      firstId: { $first: '$_id' },
      counts: { $sum: '$counts' },
      probi: { $sum: '$probi' },
      fees: { $sum: '$fees' },
      _id: {
        publisher: '$publisher',
        surveyorId: '$surveyorId'
      }
    }
  }]).toArray()
  return votes.map((vote) => {
    vote.publisher = vote._id.publisher
    vote.surveyorId = vote._id.surveyorId
    return vote
  })
}

async function aggregateReferrals (db) {
  const referrals = db.collection('referrals')
  const result = await referrals.find({
    publisher: { $ne: '' },
    owner: { $ne: null }
  }).toArray()
  return result.reduce((memo, referral) => {
    const {
      ids,
      list
    } = memo
    const {
      _id,
      publisher,
      owner,
      cohort,
      probi,
      transactionId
    } = referral
    const id = [
      transactionId,
      publisher,
      owner
    ].join('-')
    let cache = ids[id]
    if (!cache) {
      cache = {
        _id,
        transactionId,
        publisher,
        cohort,
        owner,
        identifier: id,
        probi: new BigNumber(0)
      }
      ids[id] = cache
      list.push(cache)
    }
    cache.probi = cache.probi.plus(probi)
    return memo
  }, {
    ids: {},
    list: []
  }).list
}

async function connect () {
  const [connection] = await Promise.all([
    mongodb.connect(mongoUri('eyeshade')),
    postgres.connected()
  ])
  return connection
}

async function getAllDocuments (db, collection, where) {
  const col = db.collection(collection)
  return col.find(where || {}).toArray()
}
