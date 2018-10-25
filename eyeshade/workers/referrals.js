const { updateBalances } = require('../lib/transaction.js')
const { insertReferrals } = require('../controllers/referrals')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('referral-report')
}

exports.workers = {
/* sent by POST /v1/referrals/{transactionId}

    { queue            : 'referral-report'
    , message          :
      { transactionId  : '...', shouldUpdateBalances: false }
    }
*/
  'referral-report': referralReport
}

async function referralReport (debug, runtime, payload) {
  const {
    config
  } = runtime
  const {
    altcurrency = 'BAT',
    referrals
  } = config

  const {
    amount,
    currency
  } = referrals

  const probi = await runtime.currency.fiat2alt(currency, amount, altcurrency)
  const probiString = probi.toString()

  const {
    transactionId,
    shouldUpdateBalances
  } = payload
  const options = {
    probi: probiString,
    transactionId,
    altcurrency
  }

  const docs = await getReferrals(debug, runtime, transactionId)
  const documents = await backfillReferrals(debug, runtime, docs)

  try {
    await runtime.postgres.transaction(async (client) => {
      const inserter = insertReferrals(runtime, client, options)
      await Promise.all(documents.map(inserter))
      if (!shouldUpdateBalances) {
        return
      }
      await updateBalances(runtime, client)
    })
  } catch (e) {
    runtime.captureException(e, {
      extra: {
        report: 'referral-report',
        transactionId
      }
    })
  }
}

async function backfillReferrals (debug, runtime, docs) {
  const publishers = runtime.database.get('publishers', debug)
  const documents = await Promise.all(docs.map(async ({
    firstId,
    probi,
    _id
  }) => {
    if (!_id.owner) {
      const pub = await publishers.findOne({
        publisher: _id.publisher
      })
      _id.owner = pub.owner || pub.authority || _id.owner
    }
    return {
      _id,
      probi,
      firstId
    }
  }))
  return documents
}

async function getReferrals (debug, runtime, transactionId) {
  const referrals = runtime.database.get('referrals', debug)
  const refs = await referrals.aggregate([
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
  return refs
}
