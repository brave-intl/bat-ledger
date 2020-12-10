const { normalizeChannel } = require('bat-utils/lib/extras-utils')

const transaction = require('../lib/transaction')
const referrals = require('../lib/referrals')
const queries = require('../lib/queries')
const countries = require('../lib/countries')

const getTransactionsById = `
SELECT id
FROM transactions
WHERE id = any($1::UUID[])`

module.exports.consumer = (runtime) => {
  const { kafka, postgres, config } = runtime
  kafka.on(referrals, async (messages, client) => {
    const inserting = {}
    const {
      rows: referralGroups
    } = await postgres.query(queries.getActiveCountryGroups(), [], client)

    const docs = await kafka.mapMessages(referrals, messages, async (ref) => {
      const {
        ownerId: owner,
        channelId: publisher,
        transactionId,
        downloadId,
        countryGroupId,
        finalizedTimestamp
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
        firstId: new Date(finalizedTimestamp),
        transactionId: txId
      }

      const normalizedChannel = normalizeChannel(referral._id.publisher)
      const id = transaction.id.referral(txId, normalizedChannel)
      return {
        id,
        referral
      }
    })

    // drop documents that do not start with 'removed' id
    const ownerPrefix = 'publishers#uuid:'
    const wasMissingPrefix = {}
    const filteredDocs = docs.map((doc) => {
      if (doc.referral._id.owner.slice(0, 16) !== ownerPrefix) {
        doc.referral._id.owner = ownerPrefix + doc.referral._id.owner
        wasMissingPrefix[doc.id] = true
      }
      return doc
    }).filter((doc) => {
      const { referral: { _id: { owner } } } = doc
      const throwAway = owner && owner.slice(16) === 'removed'
      if (throwAway) {
        runtime.captureException(new Error('referral owner removed'), {
          extra: doc
        })
      }
      return !throwAway
    })
    const ids = filteredDocs.map(({ id }) => id)
    const {
      rows: previouslyInserted
    } = await postgres.query(getTransactionsById, [ids])
    return Promise.all(filteredDocs.map(async ({ id: targetId, referral }) => {
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
        if (wasMissingPrefix[targetId]) {
          await postgres.query(`
          update transactions
          set to_account = $2
          where id = $1`, [targetId, referral._id.owner], client)
        }
        return
      }
      return transaction.insertFromReferrals(runtime, client, referral)
    }))
  })
}
