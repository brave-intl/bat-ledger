const { serial: test } = require('ava')
const { v4: uuidV4 } = require('uuid')
const { Runtime } = require('bat-utils')
const {
  insertFromSettlement
} = require('../../eyeshade/lib/transaction')
const {
  agents,
  ok,
  cleanEyeshadePgDb
} = require('../utils')

const {
  BAT_REDIS_URL,
  BAT_POSTGRES_URL,
  BAT_RATIOS_URL,
  BAT_RATIOS_TOKEN
} = process.env

const today = new Date('2018-07-30')
const runtime = new Runtime({
  prometheus: {
    label: 'eyeshade.worker.1'
  },
  wallet: {
    settlementAddress: {
      BAT: '0xdeadbeef'
    }
  },
  currency: {
    url: BAT_RATIOS_URL,
    access_token: BAT_RATIOS_TOKEN
  },
  cache: {
    redis: {
      url: BAT_REDIS_URL
    }
  },
  postgres: {
    connectionString: BAT_POSTGRES_URL
  }
})

const docId = {
  toString: () => '5b5e55000000000000000000' // 2018-07-30T00:00:00.000Z
}
docId.toHexString = docId.toString
const settlementId = uuidV4().toLowerCase()
const ownerId = 'publishers#uuid:' + uuidV4().toLowerCase()

const contributionSettlement = {
  probi: '9500000000000000000',
  fees: '500000000000000000',
  altcurrency: 'BAT',
  _id: docId,
  type: 'contribution',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId,
  address: uuidV4().toLowerCase(),
  amount: '9.5',
  currency: 'BAT'
}

const referralSettlement = {
  probi: '10000000000000000000',
  fees: '0',
  altcurrency: 'BAT',
  _id: docId,
  type: 'referral',
  publisher: 'foo.com',
  owner: ownerId,
  settlementId,
  address: uuidV4().toLowerCase(),
  amount: '10',
  currency: 'BAT'
}

test.afterEach.always(cleanEyeshadePgDb.bind(null, runtime.postgres))

test('check auth', async (t) => {
  const votingStatsEmpty = await getStatsFor('grants', 'ads', {
    start: new Date(),
    agent: agents.eyeshade.global
  })
  t.deepEqual({ amount: '0', count: '0' }, votingStatsEmpty, 'an empty set of stats should return')

  const goldEmpty = await getStatsFor('settlements', 'referral', {
    settlementCurrency: 'XAG',
    agent: agents.eyeshade.global
  })
  t.deepEqual({ amount: '0' }, goldEmpty, 'an empty set of stats should return')
})

test('stats for settlements', async (t) => {
  const contributionStatsEmpty = await getStatsFor('settlements', 'contribution')
  const referralStatsEmpty = await getStatsFor('settlements', 'referral')
  t.deepEqual({ amount: '0' }, contributionStatsEmpty, 'an empty set of stats should return')
  t.deepEqual({ amount: '0' }, referralStatsEmpty, 'an empty set of stats should return')

  const client = await runtime.postgres.connect()
  try {
    await insertFromSettlement(runtime, client, contributionSettlement)
    await insertFromSettlement(runtime, client, Object.assign({}, contributionSettlement, {
      settlementId: uuidV4()
    }))
    const contributionStats = await getStatsFor('settlements', 'contribution')
    t.is(19, +contributionStats.amount, 'contributions are summed')

    await insertFromSettlement(runtime, client, referralSettlement)
    await insertFromSettlement(runtime, client, Object.assign({}, referralSettlement, {
      settlementId: uuidV4()
    }))

    // bad type (referrals)
    await getStatsFor('settlements', 'referrals', {
      expect: 400
    })
    const referralStats = await getStatsFor('settlements', 'referral')
    t.is(20, +referralStats.amount, 'referrals are summed')

    const goldEmpty = await getStatsFor('settlements', 'referral', {
      settlementCurrency: 'XAG'
    })
    t.deepEqual({ amount: '0' }, goldEmpty, 'should only show the results paid out in XAU')

    await insertFromSettlement(runtime, client, Object.assign({}, referralSettlement, {
      settlementId: uuidV4(),
      currency: 'XAG',
      amount: '0.000125'
    }))
    const goldReferral = await getStatsFor('settlements', 'referral', {
      settlementCurrency: 'XAG'
    })
    t.deepEqual(10, +goldReferral.amount, 'should only show the results paid out in XAU')

    const allBody = await getStatsFor('settlements', 'referral')
    t.deepEqual(30, +allBody.amount, 'all referrals can be summed')
  } finally {
    await client.release()
  }
})

async function getStatsFor (prefix, type, options = {}) {
  const {
    start = today,
    settlementCurrency,
    expect = ok,
    agent = agents.eyeshade.stats
  } = options
  const begin = start.toISOString()
  const qs = settlementCurrency ? `?settlement_currency=${settlementCurrency}` : ''
  const date = begin.split('T')[0]
  const url = `/v1/stats/${prefix}/${type}/${date}${qs}`
  const { body } = await agent
    .get(url)
    .expect(expect)
  return body
}
