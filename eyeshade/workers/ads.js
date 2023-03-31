import cron from 'cron-parser'
import { v4 as uuidV4 } from 'uuid'
import underscore from 'underscore'

const createPayoutReportQuery = 'insert into payout_reports_ads (id) values ($1)'

const selectWalletBalancesQuery = `
  with ads_balances as (
    select
      account_id,
      sum(amount) as balance
    from account_transactions
    where account_type = 'payment_id'
    and created_at < date_trunc('month', current_date)
    group by account_id
    order by balance desc
  )
  select
    account_id,
    balance
  from ads_balances
  where balance > 0
`

const createPotentialPaymentsQuery = 'insert into potential_payments_ads (payout_report_id, payment_id, provider_id, amount) values ($1, $2, $3, $4)'

// Takes a snapshot of ad account balances
// and inserts them into potential_payments
const monthly = async (debug, runtime) => {
  const client = await runtime.postgres.connect()
  const walletsCollection = runtime.database.get('wallets', debug)
  const payoutReportId = uuidV4()

  try {
    await client.query('BEGIN')
    // First create the payout report
    await runtime.postgres.query(createPayoutReportQuery, [payoutReportId], client)
    // Next get all the payment_id, balance pairs for all the wallets
    const walletBalances = (await runtime.postgres.query(selectWalletBalancesQuery, [], client)).rows
    // Now insert the balance snapshots as potential ads payments
    for (let i = 0; i < walletBalances.length; i += 1) {
      const walletBalance = walletBalances[i]
      const wallet = await walletsCollection.findOne({ paymentId: walletBalance.account_id })
      const providerId = wallet.providerId
      runtime.postgres.query(createPotentialPaymentsQuery, [payoutReportId, walletBalance.account_id, providerId, walletBalance.balance], client)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw (e)
  } finally {
    client.release()
  }
}

const initialize = async (debug, runtime) => {
  // Limit the dynos that can run this worker to 1
  if ((typeof process.env.DYNO !== 'undefined') && (process.env.DYNO !== 'worker.1')) return

  const interval = cron.parseExpression('0 0 1 * *', {})
  const next = interval.next().getTime()
  setTimeout(() => { monthly(debug, runtime) }, next - underscore.now())
}

export {
  monthly,
  initialize
}
