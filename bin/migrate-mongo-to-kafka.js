const { normalizeChannel } = require('bat-utils/lib/extras-utils')
const _ = require('underscore')
const { Runtime } = require('bat-utils')
const transaction = require('../eyeshade/lib/transaction')
const referrals = require('../eyeshade/lib/referrals')
const settlements = require('../eyeshade/lib/settlements')
const config = require('../config')

const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
config.postgres.url = process.env.MIGRATE_DATABASE_URL
config.postgres.schemaVersionCheck = false
process.env.NODE_ENV = 'production'
config.database.mongo = process.env.MIGRATE_MONGODB_URI

const rconf = _.pick(config, ['kafka', 'currency', 'postgres', 'database'])
const runtime = new Runtime(rconf)

main().catch(console.error)

async function main () {
  try {
    await runtime.kafka.producer()
    await Promise.all([
      transferFailedReferrals(),
      transferFailedSettlements()
    ])
  } catch (e) {
    console.error(e)
  } finally {
    await runtime.quit()
  }
}

async function transferFailedReferrals () {
  return connectToKafka('referrals', 'transactionId', referrals, async (queried) => {
    const ids = queried.map(({
      publisher,
      transactionId
    }) => {
      const normalizedChannel = normalizeChannel(publisher)
      return transaction.id.referral(transactionId, normalizedChannel)
    })
    const { rows } = await runtime.postgres.query(`
    select count(*)
    from transactions
    where id = any($1::uuid[])`, [ids], true)
    console.log('count', rows[0].count)
    if (!(+rows[0].count)) {
      return []
    }
    return queried.map(({
      downloadId,
      downloadTimestamp,
      finalized,
      referralCode = '',
      owner,
      publisher,
      transactionId,
      groupId,
      platform
    }) => ({
      downloadId,
      downloadTimestamp: new Date((downloadTimestamp || finalized).toISOString()),
      finalizedTimestamp: new Date(finalized.toISOString()),
      referralCode,
      ownerId: owner,
      channelId: publisher || null,
      transactionId,
      countryGroupId: groupId || originalRateId,
      platform
    }))
  })
}

async function transferFailedSettlements () {
  return connectToKafka('settlements', 'settlementId', settlements, async (queried) => {
    const ids = queried.map(({
      publisher,
      settlementId,
      type
    }) => {
      const normalizedChannel = normalizeChannel(publisher)
      return transaction.id.settlement(settlementId, normalizedChannel, type)
    })
    const { rows } = await runtime.postgres.query(`
    select count(*)
    from transactions
    where id = any($1::uuid[])`, [ids], true)
    console.log('count', rows[0].count)
    if (!(+rows[0].count)) {
      return []
    }
    return queried.map(({
      publisher,
      settlementId,
      address,
      altcurrency,
      currency,
      hash,
      owner,
      type,
      amount,
      probi,
      fees,
      fee,
      commission
    }) => ({
      publisher,
      settlementId,
      address,
      altcurrency,
      currency,
      hash,
      owner,
      type,
      amount: amount.toString(),
      probi: probi.toString(),
      fees: fees.toString(),
      fee: fee.toString(),
      commission: commission.toString()
    }))
  })
}

async function connectToKafka (collectionName, key, coder, transform) {
  const collection = runtime.database.get(collectionName, () => {})
  const ids = await collection.distinct(key)
  // filter out the empty strings
  const distinct = ids.filter((item) => item)
  for (let i = 0; i < distinct.length; i += 1) {
    const targetId = distinct[i]
    const documents = await collection.find({
      [key]: targetId,
      migrated: { $ne: true }
    })
    if (!documents.length) {
      console.log('no documents found', collectionName)
      continue
    }
    const messages = await transform(documents)
    if (!messages.length) {
      console.log('no messages transformed', collectionName)
      continue
    }
    // check for any buffer errors
    console.log('sending many', collectionName, targetId, messages.length)
    await runtime.kafka.sendMany(coder, messages)
    console.log('setting migrated', collectionName, targetId)
    await collection.update({
      [key]: targetId
    }, {
      $set: { migrated: true }
    }, {
      multi: true
    })
  }
}
