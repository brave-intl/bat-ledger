import crypto from 'crypto'
import _ from 'underscore'
import dotenv from 'dotenv'
import tweetnacl from 'tweetnacl'
import test from 'ava'
import uuidV4 from 'uuid/v4'
import { sign } from 'http-request-signature'

import Wallet from './runtime-wallet'
import Runtime from '../boot-runtime'
import utils from './extras-utils'
import braveJoi from './extras-joi'

dotenv.config()

test('validateTxSignature: works', async t => {
  const settlementAddress = uuidV4()
  const { wallet } = newRuntime(settlementAddress)
  const keypair = tweetnacl.sign.keyPair()
  const wrongKeypair = tweetnacl.sign.keyPair()

  const info = {
    provider: 'mockHttpSignature',
    altcurrency: 'BAT',
    httpSigningPubKey: utils.uint8tohex(keypair.publicKey)
  }

  const signTxn = (keypair, body, octets) => {
    if (!octets) {
      octets = JSON.stringify(body)
    }
    const headers = {
      digest: 'SHA-256=' + crypto.createHash('sha256').update(octets).digest('base64')
    }

    headers['signature'] = sign({
      headers: headers,
      keyId: 'primary',
      secretKey: utils.uint8tohex(keypair.secretKey)
    }, { algorithm: 'ed25519' })
    return { headers, octets }
  }

  let body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '20' } }
  wallet.validateTxSignature(info, signTxn(keypair, body))

  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '5.5' } }
  t.deepEqual(body, wallet.validateTxSignature(info, signTxn(keypair, body)), 'the transaction body is returned')

  // Wrong keypair
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '20' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(wrongKeypair, body)) })

  // Invalid destination
  body = { destination: uuidV4(), denomination: { currency: 'BAT', amount: '20' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })

  // Invalid currency
  body = { destination: settlementAddress, denomination: { currency: 'USD', amount: '20' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })

  // Invalid amount
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '-20' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '0.5' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })

  // test adjusting minimum amount
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '0.5' } }
  wallet.validateTxSignature(info, signTxn(keypair, body), {
    minimum: 0.1
  })
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '0.1' } }
  wallet.validateTxSignature(info, signTxn(keypair, body), {
    minimum: 0.1
  })
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '0.0999999999999' } }
  t.throws(() => wallet.validateTxSignature(info, signTxn(keypair, body), { minimum: 0.1 }), Error)

  // settlement address must be passed as destination by default
  body = { destination: uuidV4(), denomination: { currency: 'BAT', amount: '5' } }
  t.throws(() => wallet.validateTxSignature(info, signTxn(keypair, body)), Error)
  // unless a destination validator is passed
  wallet.validateTxSignature(info, signTxn(keypair, body), {
    destinationValidator: braveJoi.string().guid()
  })

  // Missing field
  body = { destination: settlementAddress, denomination: { amount: '20' } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })

  // Extra field
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '20' }, extra: false }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })
  body = { destination: settlementAddress, denomination: { currency: 'BAT', amount: '20', extra: false } }
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, body)) })

  // Duplicate field
  body = `{"destination":"${settlementAddress}","denomination":{"currency":"BAT","amount":"20"}}`
  wallet.validateTxSignature(info, signTxn(keypair, null, body))
  body = `{"destination":"${settlementAddress}","destination":"${settlementAddress}","denomination":{"currency":"BAT","amount":"20"}}`
  t.throws(() => { wallet.validateTxSignature(info, signTxn(keypair, null, body)) })
})

test('selectGrants: does not err when nothing is passed in', async t => {
  t.plan(0)
  Wallet.selectGrants()
})

test('selectGrants: returns a new array', async t => {
  t.plan(1)
  const grants = []
  const selected = Wallet.selectGrants(grants)
  t.not(grants, selected)
})

test('selectGrants: filters non active grants and sorts by expiry time', async t => {
  t.plan(2)
  const status = 'active'
  const token1 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ'
  const token2 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'
  const grant1 = { status, token: token1 }
  const grant2 = { status, token: token2 }
  const grants = [grant1, grant2]
  const selected = Wallet.selectGrants(grants)
  t.deepEqual(selected, [grant2, grant1])
  t.true(utils.extractJws(token1).expiryTime > utils.extractJws(token2).expiryTime)
})

test('createCard', async (t) => {
  const runtime = newRuntime()
  const info = {
    parameters: {
      access_token: process.env.UPHOLD_ACCESS_TOKEN,
      scope: 'cards:read user:read'
    }
  }
  const label = uuidV4()
  const currency = 'BAT'
  const result = await runtime.wallet.createCard(info, {
    currency,
    label
  })
  t.true(_.isString(result.id), 'a new card is produced')
  t.is(result.label, label, 'the label matches')
  t.is(result.currency, currency, 'the currency matches')
})

function newRuntime (settlementAddress = '0xcafe') {
  return new Runtime({
    prometheus: {
      redis: process.env.BAT_REDIS_URL,
      label: 'eyeshade.worker.1'
    },
    wallet: {
      settlementAddress: {
        BAT: settlementAddress
      },
      uphold: {
        accessToken: process.env.UPHOLD_ACCESS_TOKEN || 'none',
        clientId: process.env.UPHOLD_CLIENT_ID || 'none',
        clientSecret: process.env.UPHOLD_CLIENT_SECRET || 'none',
        environment: process.env.UPHOLD_ENVIRONMENT || 'sandbox'
      }
    }
  })
}
