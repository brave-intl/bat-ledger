const UpholdSDK = require('./runtime-uphold')
const Currency = require('./runtime-currency')

const upholdBaseUrls = {
  prod: 'https://api.uphold.com',
  sandbox: 'https://api-sandbox.uphold.com'
}

Wallet.prototype.getSettlementWallet = callBound('getSettlementWallet')

function Wallet (config, runtime) {
  if (!(this instanceof Wallet)) return new Wallet(config, runtime)

  if (!config.wallet) return

  this.config = config.wallet
  this.runtime = runtime
  if (config.wallet.uphold) {
    if ((process.env.FIXIE_URL) && (!process.env.HTTPS_PROXY)) process.env.HTTPS_PROXY = process.env.FIXIE_URL
    this.uphold = this.createUpholdSDK(this.config.uphold.accessToken)
  }

  if (config.currency) {
    this.currency = new Currency(config, runtime)
  }
}

function callBound (key) {
  return async function () {
    const { config, runtime } = this
    const { mock, uphold } = Wallet.providers
    let f = mock[key]
    if (config.uphold) {
      f = uphold[key]
    }
    if (!f) {
      const err = new Error(`no method defined: ${key}`)
      runtime.captureException(err)
      throw err
    }
    return f.apply(this, arguments)
  }
}

Wallet.prototype.createUpholdSDK = function (token) {
  const { config, runtime } = this
  const { prometheus } = runtime
  const options = {
    baseUrl: upholdBaseUrls[config.uphold.environment],
    clientId: config.uphold.clientId,
    clientSecret: config.uphold.clientSecret
  }
  const uphold = new UpholdSDK.default(prometheus, options) // eslint-disable-line new-cap
  uphold.storage.setItem(uphold.options.accessTokenKey, token)
  return uphold
}

Wallet.providers = {}

Wallet.providers.uphold = {
  getSettlementWallet: async function () {
    const { uphold, runtime } = this
    const { BAT_SETTLEMENT_ADDRESS } = process.env
    try {
      const settlementWallet = await uphold.getCard(BAT_SETTLEMENT_ADDRESS)
      return settlementWallet
    } catch (e) {
      runtime.captureException(e)
      throw e
    }
  }
}

module.exports = Wallet
