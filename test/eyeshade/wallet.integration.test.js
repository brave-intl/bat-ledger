'use strict'

import {
  serial as test
} from 'ava'
// import uuidV5 from 'uuid/v5'
import {
  debug,
  wipeDbs
} from '../utils'
import { Runtime } from 'bat-utils'
import {
  workers
} from '../../eyeshade/workers/wallet'

const feesReport = workers['fees-report']

const {
  SERVICE,
  DYNO,
  REDIS2_URL,
  REDIS_URL,
  SENTRY_DSN,
  HEROKU_SLUG_COMMIT,
  HEROKU_APP_NAME,
  UPHOLD_ACCESS_TOKEN,
  UPHOLD_CLIENT_ID,
  UPHOLD_CLIENT_SECRET,
  UPHOLD_ENVIRONMENT,
  BAT_POSTGRES_URL,
  BAT_REDIS_URL,
  BAT_FEE_ACCOUNT
} = process.env

const runtime = new Runtime({
  postgres: {
    url: BAT_POSTGRES_URL
  },
  prometheus: {
    label: SERVICE + '.' + (DYNO || 1),
    redis: REDIS2_URL || REDIS_URL || false
  },
  sentry: {
    dsn: SENTRY_DSN || false,
    slug: HEROKU_SLUG_COMMIT || 'test',
    project: HEROKU_APP_NAME || SERVICE
  },
  wallet: {
    uphold: {
      accessToken: UPHOLD_ACCESS_TOKEN || 'none',
      clientId: UPHOLD_CLIENT_ID || 'none',
      clientSecret: UPHOLD_CLIENT_SECRET || 'none',
      environment: UPHOLD_ENVIRONMENT || 'sandbox'
    }
  },
  cache: {
    redis: {
      url: BAT_REDIS_URL
    }
  }
})

test.afterEach.always(wipeDbs(runtime.postgres))

test('gather transactions', async (t) => {
  const txns = await runtime.wallet.getFees(basicHandler(t, 3), {
    itemsPerPage: 3
  })
  t.is(txns.length, 3)
})

test('can iterate over multiple pages', async (t) => {
  const txns = await runtime.wallet.getFees(basicHandler(t, 8), {
    itemsPerPage: 3
  })
  t.is(txns.length, 8)
})

function basicHandler (t, endAt) {
  return (tx, end, results) => {
    if (results.length === endAt) {
      return end()
    }
    const { origin, destination } = tx
    const hash = {
      [BAT_FEE_ACCOUNT]: true
    }
    const associated = hash[origin.CardId] || hash[destination.CardId]
    t.true(associated, 'these transactions have to do with the io of the fees card')
    return tx
  }
}

test('fees-report', async (t) => {
  await feesReport(debug, runtime, {
    itemLimit: 10
  })
  await verifyAmount()
  const reChecked = await feesReport(debug, runtime, {
    itemLimit: 10
  })
  t.is(1, reChecked.length, 'one was checked again and was found to be in conflict')
  await verifyAmount()

  async function verifyAmount () {
    const query = `
    SELECT *
    FROM transactions
    WHERE
        to_account = $1
    OR  from_account = $1;`
    const {
      rows
    } = await runtime.postgres.query(query, [BAT_FEE_ACCOUNT])
    t.deepEqual(10, rows.length, 'rows are known')
  }
})
