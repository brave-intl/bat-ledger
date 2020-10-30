const boom = require('boom')
const { BigNumber } = require('bat-utils/lib/extras-utils')
const promotionIdExclusions = {
  'cba1e5c0-8081-49cb-b4b8-05e109c96fd4': true,
  'f8913681-eab9-48c2-890e-c40d4a3efb95': true,
  '1a9f55c7-6d54-41c6-97cd-7b8c4a290641': true,
  'c7a12742-2c7c-4ffc-9732-0e601e844099': true,
  'f66eac41-22b1-4c11-94ce-9c504d0539d8': true,
  '74bc56a0-f4f9-4ac5-84a7-65e9babc41ff': true,
  'bc4d2067-dfe6-4f9b-9bf7-5bd80ec99180': true
}
const promotionIdBonuses = {
  '6cb7ac17-963c-4175-bd52-fd7a8179dd87': '25',
  '21870643-7e03-4b0b-a0c4-b9e1eb9b046c': '25'
}
module.exports = {
  promotionIdExclusions,
  promotionIdBonuses,
  reformWalletGet,
  createComposite
}

function createComposite ({
  type,
  amount = 0,
  lastClaim: date
}) {
  const lastClaim = date && new Date(date)
  return {
    type,
    amount: (new BigNumber(amount)).toString(),
    lastClaim: lastClaim ? lastClaim.toISOString() : null
  }
}

async function reformWalletGet (debug, runtime, {
  paymentId
}) {
  const [walletResponse, parametersResponse] = await Promise.all([
    runtime.wreck.walletMigration.get(debug, `/v3/wallet/${paymentId}`),
    runtime.wreck.rewards.get(debug, '/v1/parameters')
  ])
  const { payload: walletPayload } = walletResponse
  const wallet = JSON.parse(walletPayload.toString())
  const { payload: parametersPayload } = parametersResponse
  const parameters = JSON.parse(parametersPayload.toString())
  let balancesPayload = Buffer.from(JSON.stringify({}))
  let { providerId, walletProvider, depositAccountProvider } = wallet
  if (walletProvider.name === 'uphold') {
    providerId = walletProvider.id
  } else {
    providerId = depositAccountProvider.id
  }
  if (providerId) {
    try {
      const balancesResponse = await runtime.wreck.walletMigration.get(debug, `/v3/wallet/uphold/${paymentId}`)
      balancesPayload = balancesResponse.payload
    } catch (e) {
      const { output } = e
      if (output) {
        const { statusCode } = output
        if (statusCode !== 400) {
          throw boom.boomify(e)
        }
      }
    }
  }
  const balances = JSON.parse(balancesPayload.toString())
  const total = new BigNumber((balances.total || '0.0000').toString())
  return {
    altcurrency: 'BAT',
    paymentStamp: 0,
    httpSigningPubKey: wallet.publicKey,
    addresses: {
      CARD_ID: providerId
    },
    rates: {
      BAT: 1,
      USD: parameters.batRate
    },
    parameters: {
      adFree: {
        currency: 'BAT',
        fee: {
          BAT: 10
        },
        choices: {
          BAT: parameters.autocontribute.choices
        },
        range: {
          BAT: [5, 100]
        },
        days: 30
      },
      defaultTipChoices: parameters.tips.defaultTipChoices.map((item) => item + ''),
      defaultMonthlyChoices: parameters.tips.defaultMonthlyChoices.map((item) => item + '')
    },
    balance: total.toFixed(4),
    cardBalance: new BigNumber((balances.spendable || '0').toString()).toString(),
    probi: total.times(1e18).toString(),
    unconfirmed: new BigNumber((balances.unconfirmed || '0.0000').toString()).toFixed(4)
  }
}
