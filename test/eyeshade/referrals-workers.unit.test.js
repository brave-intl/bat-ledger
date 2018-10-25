import {
  serial as test
} from 'ava'
import uuid from 'uuid'
import bson from 'bson'
import batUtils from 'bat-utils'
import {
  BigNumber
} from 'bat-utils/lib/extras-utils'
import {
  cleanDbs,
  braveYoutubePublisher,
  braveYoutubeOwner,
  cleanPgDb
} from 'bat-utils/test'
import {
  workers
} from '../../eyeshade/workers/referrals'
import {
  removeReferral,
  getByTransactionIds
} from '../../eyeshade/controllers/referrals'

const referralReport = workers['referral-report']
const transactionId = uuid.v4()
const debug = () => {}

const runtime = new batUtils.Runtime({
  altcurrency: 'BAT',
  referrals: {
    amount: 5,
    currency: 'USD'
  },
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})

const referrals = runtime.database.get('referrals', debug)

test.afterEach.always(cleanPgDb(runtime.postgres))
test.afterEach.always(cleanDbs)

test('referral-report only transfers when referral exists', async t => {
  let rows
  rows = await getByTransactionIds(runtime, [transactionId])
  t.deepEqual(rows, [])
  await runReport(false)
  await runReport(true)
  rows = await getByTransactionIds(runtime, [transactionId])
  t.deepEqual(rows, [])
  await removeReferral(runtime, transactionId)
})

test('referral-report transfers referrals when their transaction id matches', async t => {
  let rows
  const probi = (new BigNumber(10)).times(1e18).valueOf()
  const altcurrency = 'BAT'
  rows = await getByTransactionIds(runtime, [transactionId])
  t.deepEqual(rows, [])
  const $set = {
    owner: braveYoutubeOwner,
    publisher: braveYoutubePublisher,
    transactionId,
    altcurrency,
    probi: bson.Decimal128.fromString(probi)
  }
  await referrals.update({ transactionId }, { $set }, { upsert: true })
  await runReport()
  rows = await getByTransactionIds(runtime, [transactionId])
  rows[0].amount = +rows[0].amount
  t.deepEqual(rows, [{
    amount: (new BigNumber(probi)).dividedBy(1e18).toNumber(),
    channelId: braveYoutubePublisher,
    ownerId: braveYoutubeOwner,
    transactionId
  }])
  await removeReferral(runtime, transactionId)
  await referrals.remove({ transactionId })
})

function runReport () {
  return referralReport(debug, runtime, {
    transactionId
  })
}
