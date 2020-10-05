const { BigNumber, normalizeChannel } = require('bat-utils/lib/extras-utils')
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
    // await runtime.kafka.producer()
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
    const { publisher, transactionId } = queried[0]
    const normalizedChannel = normalizeChannel(publisher)
    const id = transaction.id.referral(transactionId, normalizedChannel)
    const { rows } = await runtime.postgres.query(`
    select * from transactions where id = $1`, [id])
    if (!rows.length) {
      return []
    }
    const altcurrency = 'BAT'
    const scale = runtime.currency.alt2scale(altcurrency)
    return queried.map(({
      downloadId,
      downloadTimestamp,
      finalized,
      referralCode = '',
      owner,
      publisher,
      transactionId,
      groupId,
      platform,
      probi,
      payoutRate
    }) => ({
      downloadId,
      downloadTimestamp: new Date((downloadTimestamp || finalized).toISOString()),
      finalized: new Date(finalized.toISOString()),
      referralCode,
      altcurrency,
      owner,
      publisher: publisher || null,
      transactionId,
      countryGroupId: groupId || originalRateId,
      platform,
      probi: probi.toString(),
      payoutRate: payoutRate || (new BigNumber(probi)).dividedBy(scale).dividedBy(5).toString()
    }))
  }, async ({ publisher, owner, transactionId }) => {
    return {
      publisher,
      owner,
      transactionId
    }
  })
}

async function transferFailedSettlements () {
  return connectToKafka('settlements', 'settlementId', settlements, async (queried) => {
    const { publisher, transactionId, type } = queried[0]
    const normalizedChannel = normalizeChannel(publisher)
    const id = transaction.id.settlement(transactionId, normalizedChannel, type)
    const { rows } = await runtime.postgres.query(`
    select * from transactions where id = $1`, [id])
    if (!rows.length) {
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
      timestamp,
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
      createdAt: (new Date(timestamp.getTime() * 1000)).toISOString(),
      amount: amount.toString(),
      probi: probi.toString(),
      fees: fees.toString(),
      fee: fee.toString(),
      commission: commission.toString()
    }))
  }, async ({ publisher, owner, settlementId }) => {
    return {
      publisher,
      owner,
      settlementId
    }
  })
}

async function connectToKafka (collectionName, key, coder, transform, filter) {
  const collection = runtime.database.get(collectionName, () => {})
  const ids = await collection.distinct(key)
  // filter out the empty strings
  const distinct = ids.filter((item) => item)
  console.log('distinct', distinct)
  for (let i = 0; i < distinct.length; i += 1) {
    console.log('finding', collectionName, distinct[i])
    const documents = await collection.find({
      [key]: distinct[i],
      migrated: { $ne: true }
    })
    console.log('transforming', collectionName, distinct[i])
    const messages = await transform(documents)
    console.log('transformed', messages.length, distinct[i])
    if (!messages.length) {
      continue
    }
    // check for any buffer errors
    console.log('encoding', collectionName, distinct[i])
    const msgs = messages.map((msg) => coder.typeV1.toBuffer(msg))
    console.log('sending', collectionName, distinct[i])
    for (let j = 0; j < msgs.length; j += 1) {
      await runtime.kafka.send(
        coder.topic,
        msgs[j]
      )
    }
    // const toUpdate = messages.map((msg) => ({
    //   updateMany: {
    //     upsert: false,
    //     filter: filter(msg),
    //     update: {
    //       $set: {
    //         migrated: true
    //       }
    //     }
    //   }
    // }))
    console.log('bulkwriting', collectionName, distinct[i])
    // const result = await collection.bulkWrite(toUpdate)
    // if (!result.ok) {
    //   console.error(result)
    // }
  }
}
