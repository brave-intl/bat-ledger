const BigNumber = require('bignumber.js')
const SDebug = require('sdebug')
const UpholdSDK = require('@uphold/uphold-sdk-javascript')
const bitcoinjs = require('bitcoinjs-lib')
const bitgo = require('bitgo')
const crypto = require('crypto')
const underscore = require('underscore')
const { verify } = require('@uphold/http-signature')

const braveHapi = require('./extras-hapi')
const Currency = require('./runtime-currency')
const timeout = require('./extras-utils').timeout

const debug = new SDebug('wallet')

const Wallet = function (config, runtime) {
  if (!(this instanceof Wallet)) return new Wallet(config, runtime)

  if (!config.wallet) throw new Error('config.wallet undefined')

  this.config = config.wallet
  this.runtime = runtime
  if (config.wallet.bitgo) {
    this.bitgo = new bitgo.BitGo({
      accessToken: config.wallet.bitgo.accessToken,
      env: config.wallet.bitgo.environment || 'prod'
    })
  }

  if (!config.currency) config.currency = underscore.extend({ altcoins: [ 'BTC' ] }, this.config)
  this.currency = new Currency(config, runtime)
}

Wallet.prototype.create = async function (requestType, request) {
  let f = Wallet.providers.mock.create
  if (this.config.uphold) {
    f = Wallet.providers.uphold.create
  }
  if (this.config.bitgo && requestType === 'bitcoinMultisig') {
    f = Wallet.providers.bitgo.create
  }
  if (!f) return {}
  return f.bind(this)(requestType, request)
}

Wallet.prototype.balances = async function (info) {
  const f = Wallet.providers[info.provider].balances

  if (!f) throw new Error('provider ' + info.provider + ' balances not supported')
  return f.bind(this)(info)
}

Wallet.prototype.transfer = async function (info, satoshis) {
  const f = Wallet.providers[info.provider].transfer

  if (!f) throw new Error('provider ' + info.provider + ' transfer not supported')
  return f.bind(this)(info, satoshis)
}

Wallet.prototype.getTxProbi = function (info, txn) {
  if (info.altcurrency === 'BTC') {
    const tx = bitcoinjs.Transaction.fromHex(txn)
    for (let i = tx.outs.length - 1; i >= 0; i--) {
      if (bitcoinjs.address.fromOutputScript(tx.outs[i].script) !== this.config.settlementAddress['BTC']) continue

      return new BigNumber(tx.outs[i].value)
    }
  } else if (info.altcurrency === 'BAT' && (info.provider === 'uphold' || info.provider === 'mockHttpSignature')) {
    return new BigNumber(txn.denomination.amount).times(this.currency.alt2scale(info.altcurrency))
  } else {
    throw new Error('getTxProbi not supported for ' + info.altcurrency + ' at ' + info.provider)
  }

  return new BigNumber(0)
}

Wallet.prototype.validateTxSignature = function (info, txn, signature) {
  if (info.altcurrency === 'BTC') {
    const signedTx = bitcoinjs.Transaction.fromHex(signature)
    const unsignedTx = bitcoinjs.Transaction.fromHex(txn)

    if ((unsignedTx.version !== signedTx.version) || (unsignedTx.locktime !== signedTx.locktime)) return false

    if (unsignedTx.ins.length !== signedTx.ins.length) return false
    for (let i = 0; i < unsignedTx.ins.length; i++) {
      if (!underscore.isEqual(underscore.omit(unsignedTx.ins[i], 'script'), underscore.omit(signedTx.ins[i], 'script'))) {
        return false
      }
    }

    return underscore.isEqual(unsignedTx.outs, signedTx.outs)
  } else if (info.altcurrency === 'BAT' && (info.provider === 'uphold' || info.provider === 'mockHttpSignature')) {
    if (!signature.headers.digest) throw new Error('a valid http signature must include the content digest')
    const expectedDigest = 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(txn), 'utf8').digest('base64')
    if (expectedDigest !== signature.headers.digest) throw new Error('the digest specified is not valid for the unsigned transaction provided')

    const result = verify({headers: signature.headers, publicKey: info.httpSigningPubKey}, { algorithm: 'ed25519' })
    return result.verified
  } else {
    throw new Error('wallet validateTxSignature for requestType ' + info.requestType + ' not supported for altcurrency ' + info.altcurrency)
  }
}

Wallet.prototype.submitTx = async function (info, txn, signature) {
  const f = Wallet.providers[info.provider].submitTx

  if (!f) throw new Error('provider ' + info.provider + ' submitTx not supported')
  return f.bind(this)(info, txn, signature)
}

Wallet.prototype.unsignedTx = async function (info, amount, currency, balance) {
  const f = Wallet.providers[info.provider].unsignedTx

  if (!f) throw new Error('provider ' + info.provider + ' unsignedTx not supported')
  return f.bind(this)(info, amount, currency, balance)
}

Wallet.providers = {}

Wallet.providers.bitgo = {
  create: async function (requestType, request) {
    if (requestType !== 'bitcoinMultisig') {
      throw new Error('provider bitgo create requestType ' + requestType + ' not supported')
    }
    const prefix = request['prefix']
    const label = request['label']
    const keychains = request['keychains']
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
    result.wallet.altcurrency = 'BTC'

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

    result.addresses = {'BTC': result.id}

    return result
  },
  balances: async function (info) {
    const wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: info.address })

    return {
      balance: wallet.balance(),
      spendable: wallet.spendableBalance(),
      confirmed: wallet.confirmedBalance(),
      unconfirmed: wallet.unconfirmedReceives()
    }
  },

  submitTx: async function (info, unsignedTx, signedTx) {
    const wallet = await this.bitgo.wallets().get({ type: 'bitcoin', id: info.address })
    let details, result

    result = await wallet.sendTransaction({ tx: signedTx })

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
    underscore.extend(result, { fee: details.fee.toString() })

    for (let i = details.outputs.length - 1; i >= 0; i--) {
      if (details.outputs[i].account !== this.config.settlementAddress['BTC']) continue

      underscore.extend(result, { address: details.outputs[i].account, satoshis: details.outputs[i].value })
      break
    }

    return result
  },

  unsignedTx: async function (info, amount, currency, balance) {
    balance = Number(balance)
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
      recipients[this.config.settlementAddress['BTC']] = desired - fee

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

Wallet.providers.uphold = {
  create: async function (requestType, request) {
    if (requestType === 'httpSignature') {
      const altcurrency = request.body.currency
      if (altcurrency === 'BAT') {
        // FIXME abstract out so it isn't duped 3x
        const upholdBaseUrls = {
          'prod': 'https://api.uphold.com',
          'sandbox': 'https://api-sandbox.uphold.com'
        }
        const uphold = new UpholdSDK.default({ // eslint-disable-line new-cap
          baseUrl: upholdBaseUrls[this.config.uphold.environment],
          clientId: this.config.uphold.clientId,
          clientSecret: this.config.uphold.clientSecret
        })
        if (this.config.uphold.environment === 'sandbox') {
          // have to do some hacky shit to use a personal access token
          uphold.storage.setItem('uphold.access_token', this.config.uphold.accessToken)
        } else {
          uphold.authorize() // ?
        }
        const wallet = await uphold.api('/me/cards', ({ body: request.body, method: 'post', headers: request.headers }))
        const ethAddr = await uphold.createCardAddress(wallet.id, 'ethereum')
        return { 'wallet': { 'addresses': {
          'BAT': ethAddr.id,
          'CARD_ID': wallet.id
        },
          'provider': 'uphold',
          'providerId': wallet.id,
          'httpSigningPubKey': request.body.publicKey,
          'altcurrency': 'BAT' } }
      } else {
        throw new Error('wallet uphold create requestType ' + requestType + ' not supported for altcurrency ' + altcurrency)
      }
    } else {
      throw new Error('wallet uphold create requestType ' + requestType + ' not supported')
    }
  },
  balances: async function (info) {
    const upholdBaseUrls = {
      'prod': 'https://api.uphold.com',
      'sandbox': 'https://api-sandbox.uphold.com'
    }
    const uphold = new UpholdSDK.default({ // eslint-disable-line new-cap
      baseUrl: upholdBaseUrls[this.config.uphold.environment],
      clientId: this.config.uphold.clientId,
      clientSecret: this.config.uphold.clientSecret
    })
    if (this.config.uphold.environment === 'sandbox') {
      // have to do some hacky shit to use a personal access token
      uphold.storage.setItem('uphold.access_token', this.config.uphold.accessToken)
    } else {
      uphold.authorize() // ?
    }

    const cardInfo = await uphold.getCard(info.providerId)
    const balanceProbi = new BigNumber(cardInfo.balance).times(this.currency.alt2scale(info.altcurrency))
    const spendableProbi = new BigNumber(cardInfo.available).times(this.currency.alt2scale(info.altcurrency))
    return {
      balance: balanceProbi.toString(),
      spendable: spendableProbi.toString(),
      confirmed: spendableProbi.toString(),
      unconfirmed: balanceProbi.minus(spendableProbi).toString()
    }
  },
  unsignedTx: async function (info, amount, currency, balance) {
    if (info.altcurrency === 'BAT') {
      // TODO This logic should be abstracted out into the PUT wallet payment endpoint
      // such that this takes desired directly
      const rate = this.currency.rates.BAT[currency.toUpperCase()]
      var desired = new BigNumber(amount).times(this.currency.alt2scale(info.altcurrency)).dividedBy(rate.toFixed(15))
      const minimum = desired.times(0.90)

      debug('unsignedTx', { balance: balance, desired: desired, minimum: minimum })

      if (minimum.greaterThan(balance)) return

      desired = desired.floor()

      if (desired.greaterThan(balance)) desired = new BigNumber(balance)

      // FIXME calculate estimated fee?

      // FIXME # decimals?
      desired = desired.dividedBy(this.currency.alt2scale(info.altcurrency)).toFixed(4).toString()

      return { 'requestType': 'httpSignature',
        'unsignedTx': { 'denomination': { 'amount': desired, currency: 'BAT' },
          'destination': this.config.settlementAddress['BAT']
        }
      }
    } else {
      throw new Error('wallet uphold unsignedTx for ' + info.altcurrency + ' not supported')
    }
  },
  submitTx: async function (info, txn, signature) {
    if (info.altcurrency === 'BAT') {
      const upholdBaseUrls = {
        'prod': 'https://api.uphold.com',
        'sandbox': 'https://api-sandbox.uphold.com'
      }
      const uphold = new UpholdSDK.default({ // eslint-disable-line new-cap
        baseUrl: upholdBaseUrls[this.config.uphold.environment],
        clientId: this.config.uphold.clientId,
        clientSecret: this.config.uphold.clientSecret
      })
      if (this.config.uphold.environment === 'sandbox') {
        // have to do some hacky shit to use a personal access token
        uphold.storage.setItem('uphold.access_token', this.config.uphold.accessToken)
      } else {
        uphold.authorize() // ?
      }

      const postedTx = await uphold.createCardTransaction(info.providerId,
        // this is a little weird since we're using the sdk
        underscore.pick(underscore.extend(txn.denomination, {'destination': txn.destination}), ['amount', 'currency', 'destination']),
        true, // commit tx in one swoop
        null, // no otp code
        {'headers': signature.headers}
      )

      return { // TODO recheck
        probi: new BigNumber(postedTx.destination.amount).times(this.currency.alt2scale(info.altcurrency)).toString(),
        altcurrency: info.altcurrency,
        address: txn.destination,
        fee: new BigNumber(postedTx.origin.fee).plus(postedTx.destination.fee).times(this.currency.alt2scale(info.altcurrency)).toString(),
        status: postedTx.status
      }
    } else {
      throw new Error('wallet uphold submitTx for ' + info.altcurrency + ' not supported')
    }
  },
  status: async function (provider, parameters) {
    const result = {}
    let user

    user = await braveHapi.wreck.get('https://' + provider + '/v0/me', {
      headers: {
        authorization: 'Bearer ' + parameters.access_token,
        'content-type': 'application/json'
      },
      useProxyP: true
    })
    if (Buffer.isBuffer(user)) user = JSON.parse(user)
    console.log('/v0/me: ' + JSON.stringify(user, null, 2))

    user = { authorized: [ 'restricted', 'ok' ].indexOf(user.status) !== -1, address: user.username }
    if (this.currency.fiatP(user.settings.currency)) result.fiat = user.settings.currency
    console.log('result: ' + JSON.stringify(result, null, 2))

    return result
  }
}

Wallet.providers.mock = {
  create: async function (requestType, request) {
    if (requestType === 'bitcoinMultisig') {
      return { 'wallet': { 'addresses': {'BTC': request.keychains.user.xpub}, 'provider': 'mock', 'altcurrency': 'BTC' } }
    } else if (requestType === 'httpSignature') {
      const altcurrency = request.body.currency
      if (altcurrency === 'BAT') {
        // TODO change address
        return { 'wallet': { 'addresses': {'BAT': this.config.settlementAddress['BAT']},
          'provider': 'mockHttpSignature',
          'httpSigningPubKey': request.body.publicKey,
          'altcurrency': 'BAT' } }
      } else {
        throw new Error('wallet mock create requestType ' + requestType + ' not supported for altcurrency ' + altcurrency)
      }
    } else {
      throw new Error('wallet mock create requestType ' + requestType + ' not supported')
    }
  },
  balances: async function (info) {
    if (info.altcurrency === 'BTC') {
      return {
        balance: '845480',
        spendable: '845480',
        confirmed: '845480',
        unconfirmed: '0'
      }
    } else if (info.altcurrency === 'BAT') {
      return {
        balance: '32061750000000000000',
        spendable: '32061750000000000000',
        confirmed: '32061750000000000000',
        unconfirmed: '0'
      }
    } else {
      throw new Error('wallet mock balances for ' + info.altcurrency + ' not supported')
    }
  },
  unsignedTx: async function (info, amount, currency, balance) {
    if (info.altcurrency === 'BTC') {
      var tx = new bitcoinjs.TransactionBuilder()
      var txId = 'aa94ab02c182214f090e99a0d57021caffd0f195a81c24602b1028b130b63e31'
      tx.addInput(txId, 0)
      tx.addOutput(this.config.settlementAddress['BTC'], 845480)

      return { 'requestType': 'bitcoinMultisig',
        'unsignedTx': { 'transactionHex': tx.buildIncomplete().toHex() }
      }
    } else if (info.altcurrency === 'BAT' && info.provider === 'mockHttpSignature') {
      return { 'requestType': 'httpSignature',
        'unsignedTx': { 'denomination': { 'amount': '24.1235', currency: 'BAT' },
          'destination': this.config.settlementAddress['BAT']
        }
      }
    } else {
      throw new Error('wallet mock unsignedTx for ' + info.altcurrency + ' not supported')
    }
  },
  submitTx: async function (info, txn, signature) {
    if (info.altcurrency === 'BTC') {
      const tx = bitcoinjs.Transaction.fromHex(txn)
      return {
        probi: tx.outs[0].value.toString(),
        altcurrency: 'BTC',
        address: bitcoinjs.address.fromOutputScript(tx.outs[0].script),
        fee: '300',
        status: 'accepted',
        hash: 'deadbeef'
      }
    } else if (info.altcurrency === 'BAT') {
      return {
        probi: new BigNumber(txn.denomination.amount).times(this.currency.alt2scale(info.altcurrency)).toString(),
        altcurrency: txn.denomination.currency,
        address: txn.destination,
        fee: '300',
        status: 'accepted'
      }
    }
  }
}
Wallet.providers.mockHttpSignature = Wallet.providers.mock

module.exports = Wallet
