const { normalizeChannel } = require('bat-utils/lib/extras-utils')

const transaction = require('../lib/transaction')
const referrals = require('../lib/referrals')
const queries = require('../lib/queries')
const countries = require('../lib/countries')

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
            await transaction.insertFromReferrals(runtime, client, Object.assign(doc, { transactionId }))
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

module.exports.consumer = (runtime) => {
  const { kafka, postgres, config } = runtime
  kafka.on(referrals.topic, async (messages, client) => {
    const inserting = {}
    const {
      rows: referralGroups
    } = await postgres.query(queries.getActiveCountryGroups(), [], client)

    const docs = await kafka.mapMessages(referrals, messages, async (ref, timestamp) => {
      const {
        ownerId: owner,
        channelId: publisher,
        transactionId,
        downloadId,
        countryGroupId
      } = ref
      const txId = transactionId || downloadId

      const {
        probi
      } = await countries.computeValue(runtime, countryGroupId, referralGroups)

      const _id = {
        owner,
        // take care of empty string case
        publisher: publisher || null,
        altcurrency: config.altcurrency || 'BAT'
      }
      const referral = {
        _id,
        probi,
        firstId: timestamp,
        transactionId: txId
      }

      const normalizedChannel = normalizeChannel(referral._id.publisher)
      const id = transaction.id.referral(txId, normalizedChannel)
      return {
        id,
        referral
      }
    })
    const {
      rows: previouslyInserted
    } = await postgres.query(`
    select id
    from transactions
    where id = any($1::text[])`,
    [docs.map(({ id }) => id)]
    )
    return Promise.all(docs.map(async ({ id: targetId, referral }) => {
      // this part will still be checked serially and first,
      // even if one of the referrals hits the await at the bottom
      // AsyncFunction(s) run syncronously as long as possible.
      // they do not start out async. which can be a little confusing
      if (inserting[targetId]) {
        return
      }
      inserting[targetId] = true
      if (previouslyInserted.find(({
        id
      }) => id === targetId)) {
        return
      }
      await transaction.insertFromReferrals(runtime, client, referral)
    }))
  })
}
