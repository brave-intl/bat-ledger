const BigNumber = require('bignumber.js')
const SDebug = require('sdebug')
const UpholdSDK = require('@uphold/uphold-sdk-javascript')
const bitcoinjs = require('bitcoinjs-lib')
const crypto = require('crypto')
const underscore = require('underscore')
const uuid = require('uuid')
const { verify } = require('http-request-signature')

const braveHapi = require('./extras-hapi')
const braveUtils = require('./extras-utils')
const whitelist = require('./hapi-auth-whitelist')

const Currency = require('./runtime-currency')

const debug = new SDebug('wallet')

const upholdBaseUrls = {
  prod: 'https://api.uphold.com',
  sandbox: 'https://api-sandbox.uphold.com'
}

BigNumber.config({ EXPONENTIAL_AT: 28, DECIMAL_PLACES: 18 })

const Wallet = function (config, runtime) {
  if (!(this instanceof Wallet)) return new Wallet(config, runtime)

  if (!config.wallet) return

  this.config = config.wallet
  this.runtime = runtime
  if (config.wallet.uphold) {
    if ((process.env.FIXIE_URL) && (!process.env.HTTPS_PROXY)) process.env.HTTPS_PROXY = process.env.FIXIE_URL

    this.uphold = new UpholdSDK.default({ // eslint-disable-line new-cap
      baseUrl: upholdBaseUrls[this.config.uphold.environment],
      clientId: this.config.uphold.clientId,
      clientSecret: this.config.uphold.clientSecret
    })
    this.uphold.storage.setItem('uphold.access_token', this.config.uphold.accessToken)
  }

  if (config.currency) {
    this.currency = new Currency(config, runtime)
  }
}

Wallet.prototype.create = async function (requestType, request) {
  let f = Wallet.providers.mock.create
  if (this.config.uphold) {
    f = Wallet.providers.uphold.create
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

    if ((unsignedTx.version !== signedTx.version) || (unsignedTx.locktime !== signedTx.locktime)) {
      throw new Error('the signed and unsigned transactions differed')
    }

    if (unsignedTx.ins.length !== signedTx.ins.length) {
      throw new Error('the signed and unsigned transactions differed')
    }
    for (let i = 0; i < unsignedTx.ins.length; i++) {
      if (!underscore.isEqual(underscore.omit(unsignedTx.ins[i], 'script'), underscore.omit(signedTx.ins[i], 'script'))) {
        throw new Error('the signed and unsigned transactions differed')
      }
    }

    if (!underscore.isEqual(unsignedTx.outs, signedTx.outs)) throw new Error('the signed and unsigned transactions differed')
  } else if (info.altcurrency === 'BAT' && (info.provider === 'uphold' || info.provider === 'mockHttpSignature')) {
    if (!signature.headers.digest) throw new Error('a valid http signature must include the content digest')
    if (!underscore.isEqual(txn, JSON.parse(signature.octets))) throw new Error('the signed and unsigned transactions differed')
    const expectedDigest = 'SHA-256=' + crypto.createHash('sha256').update(signature.octets, 'utf8').digest('base64')
    if (expectedDigest !== signature.headers.digest) throw new Error('the digest specified is not valid for the unsigned transaction provided')

    const result = verify({headers: signature.headers, publicKey: info.httpSigningPubKey}, { algorithm: 'ed25519' })
    if (!result.verified) throw new Error('the http-signature is not valid')
  } else {
    throw new Error('wallet validateTxSignature for requestType ' + info.requestType + ' not supported for altcurrency ' + info.altcurrency)
  }
}

Wallet.prototype.unsignedTx = async function (info, amount, currency, balance) {
  const f = Wallet.providers[info.provider].unsignedTx

  if (!f) throw new Error('provider ' + info.provider + ' unsignedTx not supported')
  return f.bind(this)(info, amount, currency, balance)
}

Wallet.prototype.submitTx = async function (info, txn, signature) {
  const f = Wallet.providers[info.provider].submitTx

  if (!f) throw new Error('provider ' + info.provider + ' submitTx not supported')
  return f.bind(this)(info, txn, signature)
}

Wallet.prototype.ping = async function (provider) {
  const f = Wallet.providers[provider].ping

  if (!f) throw new Error('provider ' + provider + ' ping not supported')
  return f.bind(this)(provider)
}

Wallet.prototype.status = async function (info) {
  const f = Wallet.providers[info.provider].status

  if (!f) throw new Error('provider ' + info.provider + ' status not supported')
  return f.bind(this)(info)
}

Wallet.prototype.providers = function () {
  return underscore.keys(Wallet.providers)
}

Wallet.prototype.redeem = async function (info, txn, signature, request) {
  let balance, desired, grants, grantIds, payload, result

  if (!this.runtime.config.redeemer) return

  if (!info.grants) return

  // we could try to optimize the determination of which grant to use, but there's probably going to be only one...
  grants = info.grants.filter((grant) => grant.status === 'active')
  if (grants.length === 0) return

  // TODO check claimTimestamp against validDuration - update to expired state & exclude from calc

  if (!info.balances) info.balances = await this.balances(info)
  balance = new BigNumber(info.balances.confirmed)
  desired = new BigNumber(txn.denomination.amount).times(this.currency.alt2scale(info.altcurrency))
  if (balance.greaterThanOrEqualTo(desired)) return

  payload = {
    grants: [],
    // TODO might need paymentId later
    wallet: underscore.extend(underscore.pick(info, [ 'altcurrency', 'provider', 'providerId' ]), { publicKey: info.httpSigningPubKey }),
    transaction: Buffer.from(JSON.stringify(underscore.pick(signature, [ 'headers', 'octets' ]))).toString('base64')
  }
  grantIds = []
  let grantTotal = new BigNumber(0)
  for (let grant of grants) {
    payload.grants.push(grant.token)
    grantIds.push(grant.grantId)

    const grantContent = braveUtils.extractJws(grant.token)
    const probi = new BigNumber(grantContent.probi)
    balance = balance.plus(probi)
    grantTotal = grantTotal.plus(probi)
    if (balance.greaterThanOrEqualTo(desired)) break
  }

  if (info.cohort && this.runtime.config.testingCohorts.includes(info.cohort)) {
    return {
      probi: desired.toString(),
      altcurrency: info.altcurrency,
      address: txn.destination,
      fee: 0,
      status: 'accepted',
      grantIds: grantIds
    }
  }

  result = await braveHapi.wreck.post(this.runtime.config.redeemer.url + '/v1/grants', {
    headers: {
      'Authorization': 'Bearer ' + this.runtime.config.redeemer.access_token,
      'Content-Type': 'application/json',
      // Only pass "trusted" IP, not previous value of X-Forwarded-For
      'X-Forwarded-For': whitelist.ipaddr(request),
      'User-Agent': request.headers['user-agent']
    },
    payload: JSON.stringify(payload),
    useProxyP: true
  })
  if (Buffer.isBuffer(result)) try { result = JSON.parse(result) } catch (ex) { result = result.toString() }

  return underscore.extend(result, { grantIds: grantIds })
}

Wallet.prototype.purchaseBAT = async function (info, amount, currency, language) {
  // TBD: if there is more than one provider, use a "real" algorithm to determine which one
  for (let provider in Wallet.providers) {
    const f = Wallet.providers[provider].purchaseBAT
    let result

    if (!f) continue

    try {
      result = await f.bind(this)(info, amount, currency, language)
      if (result) return result
    } catch (ex) {
      debug('error in ' + provider + '.purchaseBAT: ' + ex.toString())
      console.log(ex.stack)
    }
  }

  return {}
}

Wallet.providers = {}

Wallet.providers.uphold = {
  create: async function (requestType, request) {
    if (requestType === 'httpSignature') {
      const altcurrency = request.body.currency
      if (altcurrency === 'BAT') {
        let btcAddr, ethAddr, ltcAddr, wallet

        try {
          wallet = await this.uphold.api('/me/cards', { body: request.octets, method: 'post', headers: request.headers })
          ethAddr = await this.uphold.createCardAddress(wallet.id, 'ethereum')
          btcAddr = await this.uphold.createCardAddress(wallet.id, 'bitcoin')
          ltcAddr = await this.uphold.createCardAddress(wallet.id, 'litecoin')
        } catch (ex) {
          debug('create', {
            provider: 'uphold',
            reason: ex.toString(),
            operation: btcAddr ? 'litecoin' : ethAddr ? 'bitcoin' : wallet ? 'ethereum' : '/me/cards'
          })
          throw ex
        }
        return { 'wallet': { 'addresses': {
          'BAT': ethAddr.id,
          'BTC': btcAddr.id,
          'CARD_ID': wallet.id,
          'ETH': ethAddr.id,
          'LTC': ltcAddr.id
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
    let cardInfo

    try {
      cardInfo = await this.uphold.getCard(info.providerId)
    } catch (ex) {
      debug('balances', { provider: 'uphold', reason: ex.toString(), operation: 'getCard' })
      throw ex
    }

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
      let desired = new BigNumber(amount.toString()).times(this.currency.alt2scale(info.altcurrency))

      currency = currency.toUpperCase()
      if (currency !== info.altcurrency) {
        const rate = this.currency.rates.BAT[currency]
        if (!rate) throw new Error('no conversion rate for ' + currency + ' to BAT')

        desired = desired.dividedBy(new BigNumber(rate.toString()))
      }
      const minimum = desired.times(0.90)

      debug('unsignedTx', { balance: balance, desired: desired, minimum: minimum })

      if (minimum.greaterThan(balance)) return

      desired = desired.floor()

      if (desired.greaterThan(balance)) desired = new BigNumber(balance)

      // NOTE skipping fee calculation here as transfers within uphold have none

      desired = desired.dividedBy(this.currency.alt2scale(info.altcurrency)).toString()

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
      let postedTx

      try {
        postedTx = await this.uphold.createCardTransaction(info.providerId,
                                                           // this will be replaced below, we're just placating
                                                           underscore.pick(underscore.extend(txn.denomination,
                                                                                             { destination: txn.destination }),
                                                                           ['amount', 'currency', 'destination']),
                                                           true,        // commit tx in one swoop
                                                           null,        // no otp code
                                                           { headers: signature.headers, body: signature.octets })
      } catch (ex) {
        debug('submitTx', { provider: 'uphold', reason: ex.toString(), operation: 'createCardTransaction' })
        throw ex
      }

      if (postedTx.fees.length !== 0) { // fees should be 0 with an uphold held settlement address
        throw new Error(`unexpected fee(s) charged: ${JSON.stringify(postedTx.fees)}`)
      }

      return {
        probi: new BigNumber(postedTx.destination.amount).times(this.currency.alt2scale(info.altcurrency)).toString(),
        altcurrency: info.altcurrency,
        address: txn.destination,
        fee: 0,
        status: postedTx.status
      }
    } else {
      throw new Error('wallet uphold submitTx for ' + info.altcurrency + ' not supported')
    }
  },
  ping: async function (provider) {
    try {
      return { result: await this.uphold.api('/ticker/BATUSD') }
    } catch (ex) {
      return { err: ex.toString() }
    }
  },
  status: async function (info) {
    let card, cards, currency, currencies, result, uphold, user

    try {
      uphold = new UpholdSDK.default({ // eslint-disable-line new-cap
        baseUrl: upholdBaseUrls[this.config.uphold.environment],
        clientId: this.config.uphold.clientId,
        clientSecret: this.config.uphold.clientSecret
      })
      uphold.storage.setItem('uphold.access_token', info.parameters.access_token)

      user = await uphold.api('/me')
      if (user.status !== 'pending') cards = await uphold.api('/me/cards')
    } catch (ex) {
      debug('status', { provider: 'uphold', reason: ex.toString(), operation: '/me' })
      throw ex
    }

    currency = user.settings.currency
    if (currency) {
      currencies = underscore.keys(user.balances.currencies) || []
      currencies.sort((a, b) => {
        return ((b === currency) ? 1
                : ((a === currency) || (a < b)) ? (-1)
                : (a > b) ? 1 : 0)
      })
      if (currencies.indexOf(currency) === -1) currencies.unshift(currency)
    } else currency = undefined

    result = {
      provider: info.provider,
      authorized: [ 'restricted', 'ok' ].indexOf(user.status) !== -1,
      defaultCurrency: info.defaultCurrency || currency,
      availableCurrencies: currencies
    }
    if (result.authorized) {
      card = underscore.findWhere(cards, { currency: result.defaultCurrency })
      result.address = card && card.id
    }

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
        // TODO generate random addresses?
        return { 'wallet': { 'addresses': {
          'BAT': this.config.settlementAddress['BAT']
        },
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

Wallet.providers.simplex = {
  purchaseBAT: async function (info, amount, currency, language) {
    const fiat = 'USD'
    const now = underscore.now()
    const params = {
      currency: 'XBT',
      partner: 'brave',
      version: '1'
    }
    const min = this.runtime.config.simplex && (this.runtime.config.simplex['MIN_' + fiat.toUpperCase()] || 5)
    let expires, quote, rate, result

    if (!this.runtime.config.simplex) return

    if (!this.currency.fiatP(currency)) {
      rate = underscore.pick(this.currency.rates[currency] || {}, fiat)
      if (!rate) return

      amount = Math.ceil(this.currency.alt2fiat(currency, amount, fiat, true))
    } else if (currency !== fiat) {
      rate = underscore.pick(this.currency.fxrates[currency])
      if (!rate) return

      amount = Math.ceil(amount / rate)
    }
    currency = fiat
    if (amount < min) amount = min

    quote = info.simplex
    if ((!quote) || (quote.expires <= now)) {
      result = await braveHapi.wreck.post(this.runtime.config.simplex.url + '/wallet/merchant/v2/quote', {
        headers: {
          accept: 'application/json',
          authorization: 'ApiKey ' + this.runtime.config.simplex.api_key,
          'content-type': 'application/json'
        },
        payload: JSON.stringify({
          end_user_id: quote ? quote.user_id : uuid.v4().toLowerCase(),
          digital_currency: params.currency,
          fiat_currency: currency,
          requested_currency: currency,
          requested_amount: amount,
          wallet_id: params.partner
        })
      })
      if (Buffer.isBuffer(result)) try { result = JSON.parse(result) } catch (ex) { result = result.toString() }

      expires = new Date(result.valid_until).getTime()
      if ((isNaN(expires)) || (!result.quote_id)) return

      quote = underscore.extend(result, { expires: expires })
    }
    quote.payment_id = uuid.v4().toLowerCase()

    result = await braveHapi.wreck.post(this.runtime.config.simplex.url + '/wallet/merchant/v1/payments/partner/data', {
      headers: {
        accept: 'application/json',
        authorization: 'ApiKey ' + this.runtime.config.simplex.api_key,
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        account_details: {
          app_provider_id: params.partner,
          app_version_id: params.version,
          app_end_user_id: quote.user_id,
          signup_login: {
            ip: '213.162.55.5',
            accept_language: language,
            http_accept_language: language,
            timestamp: new Date(now).toISOString()
          }
        },
        transaction_details: {
          payment_details: {
            quote_id: quote.quote_id,
            payment_id: quote.payment_id,
            order_id: uuid.v4().toLowerCase(),
            fiat_total_amount: {
              currency: quote.fiat_money.currency,
              amount: quote.fiat_money.total_amount
            },
            requested_digital_amount: quote.digital_money,
            destination_wallet: {
              currency: params.currency,
              address: info.addresses.BTC
            }
          }
        }
      })
    })
    if (Buffer.isBuffer(result)) try { result = JSON.parse(result) } catch (ex) { result = result.toString() }

    return ({
      quotes: { simplex: quote },
      buyForm: {
        method: 'POST',
        action: this.runtime.config.simplex.url + '/payments/new',
        version: params.version,
        partner: params.partner,
        payment_flow_type: 'wallet',
        return_url: 'about:preferences#payments',
        quote_id: quote.quote_id,
        payment_id: quote.payment_id,
        user_id: quote.user_id,
        'destination_wallet[address]': info.addresses.BTC,
        'destination_wallet[currency]': params.currency,
        'fiat_total_amount[amount]': quote.fiat_money.base_amount,
        'fiat_total_amount[currency]': quote.fiat_money.currency,
        explicit_fee: 'true',
        'digital_total_amount[amount]': quote.digital_money.amount,
        'digital_total_amount[currency]': quote.digital_money.currency
      }
    })
  }
}

module.exports = Wallet
