import {
  serial as test
} from 'ava'
import uuidV4 from 'uuid/v4'
import supertest from 'supertest'
import {
  ok,
  dbUri,
  debug,
  status,
  cleanDbs,
  ledgerAgent
} from '../utils'
import {
  ObjectID
} from 'bson'
import {
  Runtime
} from 'bat-utils'
import BigNumber from 'bignumber.js'
import {
  compositeGrants
} from '../../ledger/controllers/wallet'
import {
  createComposite
} from '../../ledger/lib/wallet'

const statsURL = '/v2/wallet/stats'
const frozenDay = today()
const DAY = 1000 * 60 * 60 * 24
const ledgerURI = dbUri('ledger')

const runtime = new Runtime({
  database: {
    mongo: ledgerURI
  }
})

test.afterEach.always(cleanDbs)

test('a stats endpoint exists', async (t) => {
  const url = `${statsURL}/${frozenDay.toISOString()}`
  const {
    body
  } = await ledgerAgent
    .get(url)
    .expect(ok)
  t.deepEqual([], body)
})

test('stats endpoint returns wallet stats', async (t) => {
  await insert()
  const url = `${statsURL}/${frozenDay.toISOString()}`
  const {
    body
  } = await ledgerAgent
    .get(url)
    .expect(ok)
  t.deepEqual(body, [walletExpectation(frozenDay)])
})

test('stats endpoint returns wallet within 24 hr period', async (t) => {
  let body
  await insert(frozenDay)
  const prevDay = new Date(frozenDay - (frozenDay % DAY) - DAY)
  await insert(prevDay)
  ;({
    body
  } = await ledgerAgent
    .get(`${statsURL}/${frozenDay.toISOString()}`)
    .expect(ok))
  t.deepEqual(body, [walletExpectation(frozenDay)])
  ;({
    body
  } = await ledgerAgent
    .get(`${statsURL}/${prevDay.toISOString()}`)
    .expect(ok))
  t.deepEqual(body, [walletExpectation(prevDay)])
})

test('can return a [) range', async (t) => {
  const truncatedDay = new Date(frozenDay - (frozenDay % DAY))
  const prevDay = new Date(truncatedDay - DAY)
  const nextDay = new Date(truncatedDay - -DAY)
  await insert(truncatedDay)
  await insert(prevDay)
  await insert(nextDay)
  const url = `${statsURL}/${prevDay.toISOString()}/${nextDay.toISOString()}`
  const {
    body
  } = await ledgerAgent
    .get(url)
    .expect(ok)
  t.deepEqual(body, [walletExpectation(truncatedDay), walletExpectation(prevDay)])
})

test('compositing wallet grant information', async (t) => {
  const adsToken = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJjZDBkYzViZi1hZmZmLTRjMGUtYjcyOC05YzJhZjBhODBkOGMiLCJwcm9iaSI6IjEwMDAwMDAwMDAwMDAwMDAwMDAiLCJwcm9tb3Rpb25JZCI6ImJhZDQ5MTMyLWRlMzgtNDdlNy04MDAzLTk4NmFmODhlZWIxYyIsIm1hdHVyaXR5VGltZSI6MTU1ODQ1OTM2NiwiZXhwaXJ5VGltZSI6MjE2MzI2Mjk2NiwidHlwZSI6ImFkcyIsInByb3ZpZGVySWQiOiI2ZTM4MjRmNi05ZWVjLTRmNTYtOTcxOS04YWRkYWZmZTNmZjEifQ.m3xyACoN80jb8-i9zrYMqoD_0gHnEx6LW0xIw48RVvI3aJB-PXgKMi3LZh8G4ymeY_jtiW4KkPZWfBDGM0yYCQ'
  const ugpToken = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiIwZTljZjdhNy1lN2RkLTQ3MWQtOWQ0NC0wNDQwOWIxZTNkMDkiLCJwcm9iaSI6IjEwMDAwMDAwMDAwMDAwMDAwMDAiLCJwcm9tb3Rpb25JZCI6ImEyYmI5YWNkLWYyMmItNGE5Zi1iNTk2LTQ5MzYyYTZiMjI1ZCIsIm1hdHVyaXR5VGltZSI6MTU1ODQ2MDE0NSwiZXhwaXJ5VGltZSI6MjE2MzI2Mzc0NSwidHlwZSI6InVncCJ9.6exMRBhC4y8Rf0mCLHGvUhRtSKJrfv1pvN33rOm4aPl_bsoPGYwSJiE_iB3Cj7jY2Fo1AC_ewcv9eyet-2Q8Cw'
  const tokenID74bc56a0 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiIxZDE4ZDhiOC05NWI4LTQ0NjItYTM4OC0zMjk3NmM2MTdjZDEiLCJwcm9iaSI6IjEwMTAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI3NGJjNTZhMC1mNGY5LTRhYzUtODRhNy02NWU5YmFiYzQxZmYiLCJtYXR1cml0eVRpbWUiOjE1NTk3NTQ3NDgsImV4cGlyeVRpbWUiOjIxNjQ1NTgzNDgsInR5cGUiOiJhZHMifQ.M7D4hEtlGwMQutdbArFr7dEjDJCwUnwWAZ_1bvMjgljh6BHV5aWB9wIlK-7VvP76rVhPAnkf9qnW072X_b80CQ' // 10.1 bat
  const tokenIDf66eac41 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhOTJhNzM3Ny02ODU1LTQxMzctYmViZS0zNDBmNTZjMTU1MjEiLCJwcm9iaSI6IjUxMDAwMDAwMDAwMDAwMDAwMDAiLCJwcm9tb3Rpb25JZCI6ImY2NmVhYzQxLTIyYjEtNGMxMS05NGNlLTljNTA0ZDA1MzlkOCIsIm1hdHVyaXR5VGltZSI6MTU1OTc1MjA1OCwiZXhwaXJ5VGltZSI6MjE2NDU1NTY1OCwidHlwZSI6ImFkcyJ9.JrqzCdLppWqZ83bmSJiSJKmBvVIJChWwsYanpWX6NQKBOhFtBehr6T9tTeIiXjrC1B332ltPhS_BdKnrrdZuBA' // 5.1 bat
  const tokenIDc7a12742 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI1OWViNDgwMS0wNGY2LTRmZWItYmM2ZS1hNzM4NGMyMjQ2MmYiLCJwcm9iaSI6IjYwMTAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjN2ExMjc0Mi0yYzdjLTRmZmMtOTczMi0wZTYwMWU4NDQwOTkiLCJtYXR1cml0eVRpbWUiOjE1NTk3NTIxMTIsImV4cGlyeVRpbWUiOjIxNjQ1NTU3MTIsInR5cGUiOiJhZHMifQ.Jx6ox44D8RaJKsmytCwR5XqMW_xD-jXNjobt0UQE5O8PFpyZDOJggx1JSIAsMETBLiujSzQmmCV-mpjS-tKlBw' // 60.1 bat
  const tokenID21870643 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI3ZDg2NzM2Ny0xNjNjLTQ5YWEtODQ0Yi1jY2MxNThiOTM5MzMiLCJwcm9iaSI6IjM4MDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJmYjMyOGJmMS00MmFhLTRlNzEtYjk1Mi01YzUyYjU5MmQ4OTgiLCJtYXR1cml0eVRpbWUiOjE1Njc0Njg4MDAsImV4cGlyeVRpbWUiOjE2NzI0NDQ4MDAsInR5cGUiOiJhZHMifQ.bZwbxBT4dQ1OtjTMXZF6OMta8kRRwawNtvdxCsubmaMLzd_n9dARl_7D34FzWjy3ULjHZsjPq1sDrHbJr-_YAw' // 38 bat
  const lastUgpTimestamp = new Date('2019-01-03')
  const lastAdsTimestamp = new Date('2019-01-02')
  const earliestTimestamp = new Date('2019-01-01')
  const grants = [{
    claimTimestamp: earliestTimestamp,
    token: ugpToken
  }, {
    type: 'ads',
    claimTimestamp: earliestTimestamp,
    token: adsToken
  }, {
    type: 'ads',
    claimTimestamp: lastAdsTimestamp,
    token: adsToken
  }, {
    type: 'ugp',
    claimTimestamp: lastUgpTimestamp,
    token: ugpToken
  }, {
    type: 'ads',
    claimTimestamp: +earliestTimestamp + 1,
    token: tokenID74bc56a0,
    promotionId: '74bc56a0-f4f9-4ac5-84a7-65e9babc41ff'
  }, {
    type: 'ads',
    claimTimestamp: +lastAdsTimestamp + 1,
    token: tokenIDf66eac41,
    promotionId: 'f66eac41-22b1-4c11-94ce-9c504d0539d8'
  }, {
    type: 'ads',
    claimTimestamp: +earliestTimestamp + 1,
    token: tokenIDc7a12742,
    promotionId: 'c7a12742-2c7c-4ffc-9732-0e601e844099'
  }, {
    type: 'ads',
    claimTimestamp: earliestTimestamp,
    token: tokenID21870643, // minus 25 from bonus
    promotionId: '21870643-7e03-4b0b-a0c4-b9e1eb9b046c'
  }]
  const paymentIdEmpty = uuidV4()
  const emptyURL = `/v2/wallet/${paymentIdEmpty}/grants/ads`

  // throws if no wallet found
  const emptyOptions = { type: 'ads', paymentId: paymentIdEmpty }
  await t.throwsAsync(compositeGrants(debug, runtime, emptyOptions))
  await ledgerAgent.get(emptyURL).expect(404)
  await supertest.agent(process.env.BAT_LEDGER_SERVER).get(emptyURL).expect(404)

  // end of throwing
  await insertWallet({
    paymentId: paymentIdEmpty
  })

  // no grants claimed yet
  const {
    body: emptyResponse
  } = await ledgerAgent.get(emptyURL).expect(status(204))
  t.deepEqual('', emptyResponse, 'composite matches expected')

  // insert a wallet with grant
  const paymentId = uuidV4()
  await insertWallet({
    paymentId,
    grants
  })

  const compositedAds = await compositeGrants(debug, runtime, {
    type: 'ads',
    paymentId
  })
  const {
    body: bodyAds
  } = await ledgerAgent.get(`/v2/wallet/${paymentId}/grants/ads`).expect(ok)
  const expectedAds = createComposite({
    type: 'ads',
    amount: (new BigNumber(2)).plus(13),
    lastClaim: lastAdsTimestamp
  })
  t.deepEqual(expectedAds, compositedAds, 'a composite is created correctly')
  t.deepEqual(expectedAds, bodyAds, 'a composite is responded with')

  const compositedUgp = await compositeGrants(debug, runtime, {
    type: 'ugp',
    paymentId
  })
  const {
    body: bodyUgp
  } = await ledgerAgent.get(`/v2/wallet/${paymentId}/grants/ugp`).expect(ok)
  const expectedUgp = createComposite({
    type: 'ugp',
    amount: (new BigNumber(2)),
    lastClaim: lastUgpTimestamp
  })
  t.deepEqual(expectedUgp, compositedUgp, 'a composite is created correctly')
  t.deepEqual(expectedUgp, bodyUgp, 'a composite is responded with')
})

test('wallet endpoint returns default tip choices', async (t) => {
  const paymentId = uuidV4()
  await insertWallet({ paymentId, altcurrency: 'BAT' })

  const {
    body
  } = await ledgerAgent.get(`/v2/wallet/${paymentId}`).expect(ok)
  t.deepEqual(body.parameters.defaultTipChoices, [1, 5, 10])
})

function walletExpectation (day, wallets = 1) {
  return {
    activeGrant: 0,
    anyFunds: 0,
    contributed: 0,
    created: byDay(day),
    walletProviderBalance: '0',
    walletProviderFunded: 0,
    wallets
  }
}

function byDay (d) {
  const date = new Date(d)
  const iso = date.toISOString()
  const split = iso.split('T')
  return split[0]
}

function insertWallet (options) {
  const wallets = runtime.database.get('wallets', debug)
  return wallets.insert(options)
}

async function insert (date) {
  await insertWallet({
    paymentId: uuidV4(),
    _id: ObjectID.createFromTime((date || new Date()) / 1000),
    balances: {
      confirmed: '0'
    }
  })
}

function today () {
  const DAY = 1000 * 60 * 60 * 24
  const then = new Date()
  return new Date(then - (then % DAY))
}
