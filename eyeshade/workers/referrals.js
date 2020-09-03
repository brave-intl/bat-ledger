const { insertFromReferrals, referralId } = require('../lib/transaction.js')
const referrals = require('../lib/referrals')
const { BigNumber, normalizeChannel } = require('bat-utils/lib/extras-utils')

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
