const { serial: test } = require('ava')
const { kafka } = require('../../config')
const utils = require('../utils')
const referrals = require('../../eyeshade/lib/referrals')
const { Runtime } = require('bat-utils')
const {
  cleanDbs,
  connectToDb
} = utils
const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL
} = process.env

test.before(async (t) => {
  const eyeshadeMongo = await connectToDb('eyeshade')
  Object.assign(t.context, {
    referrals: await eyeshadeMongo.collection('referrals'),
    runtime: new Runtime({
      prometheus: {
        label: 'eyeshade.worker.1'
      },
      cache: {
        redis: {
          url: BAT_REDIS_URL
        }
      },
      postgres: {
        url: BAT_POSTGRES_URL
      },
      kafka
    })
  })
})
test.beforeEach(cleanDbs)

test('referrals inserted using old methodology will match new insertion methodology', async (t) => {
  const {
    txId,
    referral: referral1
  } = utils.referral.createLegacy(null, '71341fc9-aeab-4766-acf0-d91d3ffb0bfa')
  const referral2 = utils.referral.create()

  await utils.referral.sendLegacy(txId, [referral1])
  const rowsLegacy = await utils.transaction.ensureCount(t, 1)

  referral2.transactionId = txId
  referral2.inputs[0].platform = referral1.platform
  await t.context.runtime.kafka.send(
    referrals.topic,
    referrals.typeV1.toBuffer(referral2)
  )
  const rows = await utils.transaction.ensureCount(t, 1)
  console.log(rowsLegacy, rows)
})
