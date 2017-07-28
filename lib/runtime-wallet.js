const bitcoinjs = require('bitcoinjs-lib')
const bitgo = require('bitgo')
const Currency = require('./runtime-currency')
const currencyCodes = require('currency-codes')
const SDebug = require('sdebug')
const debug = new SDebug('wallet')
const underscore = require('underscore')

const Wallet = function (config, runtime) {
  if (!(this instanceof Wallet)) return new Wallet(config, runtime)

  if (!config.wallet) throw new Error('config.wallet undefined')

  if (!config.wallet.bitgo) config.wallet = { bitgo: config.wallet }
  this.config = config.wallet
  this.config.environment = config.wallet.bitgo.environment
  this.runtime = runtime
  this.bitgo = new bitgo.BitGo({
    accessToken: config.wallet.bitgo.accessToken,
    env: config.wallet.bitgo.environment || 'prod'
  })
  debug('environment: ' + this.config.environment)

  if (!config.currency) config.currency = underscore.extend({ altcoins: [ 'BTC' ] }, this.config)
  this.currency = new Currency(config, runtime)
}

Wallet.prototype.create = async function (prefix, label, keychains) {
  const xpubs = []
  let result

  xpubs[0] = underscore.pick(await this.bitgo.keychains().add(underscore.extend({ label: 'user' }, keychains.user)), [ 'xpub' ])
  xpubs[1] = underscore.pick(await this.bitgo.keychains().add({
    label: 'unspendable',
    xpub: this.config.bitgo.unspendableXpub
  }), [ 'xpub' ])
  xpubs[2] = underscore.pick(await this.bitgo.keychains().createBitGo({}), [ 'xpub' ])

  result = await this.bitgo.wallets().add({
    label: label,
    m: 2,
    n: 3,
    keychains: xpubs,
    enterprise: this.config.bitgo.enterpriseId,
    disableTransactionNotifications: true
  })
  result.wallet.provider = 'bitgo'

  result.addWebhook({ url: prefix + '/callbacks/bitgo/sink', type: 'transaction', numConfirmations: 1 }, function (err) {
    if (err) debug('wallet addWebhook', { label: label, message: err.toString() })

    result.setPolicyRule({
      id: 'com.brave.limit.velocity.30d',
      type: 'velocityLimit',
      condition: {
        type: 'velocity',
        amount: 7000000,
        timeWindow: 30 * 86400,
        groupTags: [],
        excludeTags: []
      },
      action: { type: 'deny' }
    }, function (err) {
      if (err) debug('wallet setPolicyRule com.brave.limit.velocity.30d', { label: label, message: err.toString() })
    })
  })

  return result
}

Wallet.prototype.balances = async function (info) {
  const f = Wallet.providers[info.provider].balances

  if (!f) throw new Error('provider ' + info.provider + ' balances not supported')
  return f.bind(this)(info)
}

Wallet.prototype.purchaseBTC = function (info, amount, currency) {
  let f = Wallet.providers[info.provider].purchaseBTC

  if (!f) f = Wallet.providers.coinbase.purchaseBTC
  if (!f) return {}
  return f.bind(this)(info, amount, currency)
}

Wallet.prototype.recurringBTC = function (info, amount, currency) {
  let f = Wallet.providers[info.provider].recurringBTC

  if (!f) f = Wallet.providers.coinbase.recurringBTC
  if (!f) return {}
  return f.bind(this)(info, amount, currency)
}

Wallet.prototype.transferP = function (info) {
  const f = Wallet.providers[info.provider].transferP

  return ((!!f) && (f.bind(this)(info)))
}

Wallet.prototype.transfer = async function (info, satoshis) {
  const f = Wallet.providers[info.provider].transfer

  if (!f) throw new Error('provider ' + info.provider + ' transfer not supported')
  return f.bind(this)(info, satoshis)
}

Wallet.prototype.compareTx = function (unsignedHex, signedHex) {
  const signedTx = bitcoinjs.Transaction.fromHex(signedHex)
  const unsignedTx = bitcoinjs.Transaction.fromHex(unsignedHex)

  if ((unsignedTx.version !== signedTx.version) || (unsignedTx.locktime !== signedTx.locktime)) return false

  if (unsignedTx.ins.length !== signedTx.ins.length) return false
  for (let i = 0; i < unsignedTx.ins.length; i++) {
    if (!underscore.isEqual(underscore.omit(unsignedTx.ins[i], 'script'), underscore.omit(signedTx.ins[i], 'script'))) {
      return false
    }
  }

  return underscore.isEqual(unsignedTx.outs, signedTx.outs)
}

Wallet.prototype.submitTx = async function (info, signedTx) {
  const f = Wallet.providers[info.provider].submitTx

  if (!f) throw new Error('provider ' + info.provider + ' submitTx not supported')
  return f.bind(this)(info, signedTx)
}

Wallet.prototype.unsignedTx = async function (info, amount, currency, balance) {
  const f = Wallet.providers[info.provider].unsignedTx

  if (!f) throw new Error('provider ' + info.provider + ' unsignedTx not supported')
  return f.bind(this)(info, amount, currency, balance)
}

Wallet.providers = {}

Wallet.providers.bitgo = {
  balances: async function (info) {
    const wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: info.address })

    return {
      balance: wallet.balance(),
      spendable: wallet.spendableBalance(),
      confirmed: wallet.confirmedBalance(),
      unconfirmed: wallet.unconfirmedReceives()
    }
  },

  submitTx: async function (info, signedTx) {
    const wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: info.address })
    let details, result

    result = await wallet.sendTransaction({ tx: signedTx })

// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
    const timeout = (msec) => { return new Promise((resolve) => { setTimeout(resolve, msec) }) }

    for (let i = 0; i < 5; i++) {
      try {
        details = await this.bitgo.blockchain().getTransaction({ id: result.hash })
        break
      } catch (ex) {
        debug('getTransaction', ex)
        await timeout(1 * 1000)
        debug('getTransaction', { retry: i + 1, max: 5 })
      }
    }
    underscore.extend(result, { fee: details.fee })

    for (let i = details.outputs.length - 1; i >= 0; i--) {
      if (details.outputs[i].account !== this.config.bitgo.settlementAddress) continue

      underscore.extend(result, { address: details.outputs[i].account, satoshis: details.outputs[i].value })
      break
    }

    return result
  },

  transferP: function (info) {
    return ((!!this.config.bitgo.fundingAddress) && (!!this.config.bitgo.fundingPassphrase))
  },

  transfer: async function (info, satoshis) {
    let balance, currencies, remaining, result, wallet

    if (!this.config.bitgo.fundingAddress) throw new Error('no funding address configured')
    if (!this.config.bitgo.fundingPassphrase) throw new Error('no funding passphrase configured')

    wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: this.config.bitgo.fundingAddress })
    try {
      result = await wallet.sendCoins({
        address: info.address,
        amount: satoshis,
        walletPassphrase: this.config.bitgo.fundingPassphrase
      })

      balance = wallet.confirmedBalance()
      try {
        balance = JSON.parse(JSON.stringify(wallet)).spendableConfirmedBalance
      } catch (ex) { }
      currencies = [ 'USD', 'EUR', 'GBP' ]
      remaining = {}
      currencies.forEach((fiat) => {
        if (!this.currency.rates.BTC[fiat]) return

        const currency = currencyCodes.code(fiat)

        remaining[fiat] = ((balance * this.currency.rates.BTC[fiat]) / 1e8).toFixed(currency ? currency.digits : 2)
      })

      return underscore.extend(result, { remaining: remaining })
    } catch (ex) {
      throw new Error(ex.toString())
    }
  },

  unsignedTx: async function (info, amount, currency, balance) {
    const rate = this.currency.rates.BTC[currency.toUpperCase()]

    if (!rate) throw new Error('no such currency: ' + currency)

    const estimate = await this.bitgo.estimateFee({ numBlocks: 6 })
    const recipients = {}
    let desired, minimum, transaction, wallet
    let fee = estimate.feePerKb

    desired = (amount / rate) * 1e8
    minimum = Math.floor(desired * 0.90)
    desired = Math.round(desired)
    debug('unsignedTx', { balance: balance, desired: desired, minimum: minimum })
    if (minimum > balance) return

    if (desired > balance) desired = balance

    wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: info.address })
    for (let i = 0; i < 2; i++) {
      recipients[this.config.bitgo.settlementAddress] = desired - fee

      try {
        transaction = await wallet.createTransaction({ recipients: recipients, feeRate: estimate.feePerKb })
        debug('unsignedTx', { satoshis: desired, estimate: fee, actual: transaction.fee })
      } catch (ex) {
        debug('createTransaction', ex)
        return
      }
      if (fee <= transaction.fee) break

      fee = transaction.fee
    }

    return underscore.extend(underscore.pick(transaction, [ 'transactionHex', 'unspents', 'fee' ]),
                             { xpub: transaction.walletKeychains[0].xpub })
  }
}

Wallet.providers.coinbase = {
  purchaseBTC: function (info, amount, currency) {
    // TBD: for the moment...
    if (currency !== 'USD') throw new Error('currency ' + currency + ' payment not supported')

    return ({
      buyURL: `https://buy.coinbase.com?crypto_currency=BTC` +
                `&code=${this.config.coinbase.widgetCode}` +
                `&amount=${amount}` +
                `&address=${info.address}`
    })
  },

  recurringBTC: function (info, amount, currency) {
    // TBD: for the moment...
    if (currency !== 'USD') throw new Error('currency ' + currency + ' payment not supported')

    return ({recurringURL: `https://www.coinbase.com/recurring_payments/new?type=send&repeat=monthly` +
                `&amount=${amount}` +
                `&currency=${currency}` +
                `&to=${info.address}`
    })
  }
}

module.exports = Wallet
