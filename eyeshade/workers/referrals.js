const { insertFromReferrals, referralId } = require('../lib/transaction.js')
const referrals = require('../lib/referrals')
const { BigNumber, normalizeChannel } = require('bat-utils/lib/extras-utils')
const promo = require('./promo')
const underscore = require('underscore')
const _ = underscore
const { groupReferrals } = require('../controllers/referrals')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('referral-report')
}

exports.workers = {
/* sent by POST /v1/referrals/{transactionId}

    { queue            : 'referral-report'
    , message          :
      { transactionId  : '...' }
    }
*/
  'referral-report':
    async (debug, runtime, payload) => {
      const referrals = runtime.database.get('referrals', debug)
      const publishers = runtime.database.get('publishers', debug)
      const { transactionId } = payload
      const docs = await referrals.aggregate([
        {
          $match: { transactionId }
        },
        {
          $group: {
            _id: { publisher: '$publisher', owner: '$owner', altcurrency: '$altcurrency' },
            firstId: { $first: '$_id' },
            probi: { $sum: '$probi' }
          }
        }
      ])

      const client = await runtime.postgres.connect()
      try {
        await client.query('BEGIN')
        try {
          for (let i = 0; i < docs.length; i += 1) {
            const doc = docs[i]
            if (!doc._id.owner) {
              const pub = await publishers.findOne({ publisher: doc._id.publisher })
              if (pub) {
                if (pub.owner) {
                  doc._id.owner = pub.owner
                } else if (pub.authority) {
                  doc._id.owner = pub.authority
                }
              }
            }
            await insertFromReferrals(runtime, client, Object.assign(doc, { transactionId }))
          }
        } catch (e) {
          await client.query('ROLLBACK')
          runtime.captureException(e, { extra: { report: 'referral-report', transactionId } })
          throw e
        }
        await client.query('COMMIT')
        runtime.prometheus.getMetric('referral_inserted_counter').inc(docs.length)
      } finally {
        client.release()
      }
    }
}

module.exports.producer = (runtime) => {
  setInterval(produce, nextHour())

  async function produce () {
    const getActiveGroups = `
    SELECT
      id,
      amount,
      currency,
      active_at as "activeAt"
    FROM geo_referral_groups
    WHERE
      active_at <= current_timestamp;`

    const originalRateId = '71341fc9-aeab-4766-acf0-d91d3ffb0bfa'
    const {
      rows: referralGroups
    } = await runtime.postgres.query(getActiveGroups, [], true)
    referralGroups.sort((a) => a.activeAt)

    await Promise.all(['channel', 'owner'].map(async (type) => {
      const [txid, transactions] = await promo.payoutPayload(runtime.promo.pool(true), type)

      const referralSets = groupReferrals(await Promise.all(transactions.map(async (tx) => {
        const { groupId: passedGroupId } = tx
        const countryGroupId = passedGroupId || originalRateId
        const config = _.findWhere(referralGroups, {
          // no group has falsey id
          id: countryGroupId
        })
        if (!config) {
          throw new Error('referral group not found')
        }
        const {
          amount: groupAmount,
          currency: groupCurrency
        } = config

        const defaultDownloadTimestamp = new Date()
        const altcurrency = 'BAT'
        const factor = runtime.currency.alt2scale(altcurrency)
        const probiString = await runtime.currency.fiat2alt(groupCurrency, groupAmount, altcurrency)
        let probi = new BigNumber(probiString)
        const payoutRate = probi.dividedBy(factor).dividedBy(groupAmount).toString()
        probi = probi.toString()
        return {
          altcurrency: 'BAT',
          owner: tx.ownerId,
          publisher: tx.channelId || null,
          transactionId: txid,
          finalized: new Date(tx.finalized),
          referralCode: tx.referralCode,
          downloadId: tx.downloadId,
          downloadTimestamp: new Date(tx.downloadTimestamp || defaultDownloadTimestamp),
          countryGroupId: tx.groupId,
          platform: tx.platform,
          payoutRate,
          probi
        }
      })))
      await runtime.promo.transact(async (client) => {
        for (let i = 0; i < transactions.length; i += 1) {
          await runtime.promo.query(promo.UPDATE_QUERY, [txid, transactions[i].downloadId], client)
        }
        const producer = await runtime.kafka.producer()
        for (let i = 0; i < referralSets.length; i += 1) {
          const buf = referrals.typeV1.toBuffer(referralSets[i])
          await producer.send(referrals.topic, buf)
        }
      })
    }))
  }

  function nextHour () {
    const now = new Date()
    const hour = 1000 * 60 * 60
    const remaining = +now % hour
    return hour - remaining
  }
}

module.exports.consumer = (runtime) => {
  runtime.kafka.on(referrals.topic, async (messages, client) => {
    await eachMessage(referrals, messages, async (referralSet) => {
      const zero = new BigNumber(0)
      const {
        inputs,
        owner,
        publisher,
        altcurrency,
        transactionId,
        createdAt
      } = referralSet
      const probi = inputs.reduce((memo, { probi }) => memo.plus(probi), zero)
      const _id = {
        owner,
        publisher: publisher || null,
        altcurrency
      }
      const referral = {
        // come back later and fix inputs
        _id,
        // this is all we care about from a transaction perspective
        probi,
        firstId: new Date(createdAt),
        transactionId
      }

      const normalizedChannel = normalizeChannel(referral._id.publisher)
      const id = referralId(transactionId, normalizedChannel)
      /*
      because of this error
      error: current transaction is aborted, commands ignored until end of transaction block
      we have to check first
      only one client should be inserting a given message
      so we should not run into errors
      */
      const { rows } = await client.query('select * from transactions where id = $1', [id])
      if (!rows.length) {
        await insertFromReferrals(runtime, client, referral)
      }
    })
  })

  async function eachMessage (decoder, messages, fn) {
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i]
      const buf = Buffer.from(msg.value, 'binary')
      let message
      try {
        ;({ message } = decoder.decode(buf))
      } catch (e) {
        // If the event is not well formed, capture the error and continue
        runtime.captureException(e, { extra: { topic: decoder.topic, message } })
        continue
      }
      await fn(message)
    }
  }
}
