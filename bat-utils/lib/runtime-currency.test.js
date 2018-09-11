'use strict'

import Currency from './runtime-currency'
import test from 'ava'
import _ from 'underscore'
import dotenv from 'dotenv'
dotenv.config()

const currency = Currency({
  currency: {
    url: process.env.BAT_RATIOS_URL,
    access_token: process.env.BAT_RATIOS_TOKEN
  }
}, {})

test('instantiates correctly', (t) => {
  t.plan(1)
  t.true(_.isObject(currency))
})

test('get the ratio', async (t) => {
  t.plan(1)
  const result = await currency.ratio('BAT', 'USD')
  t.true(_.isNumber(result))
})

test('get decimal scale', async (t) => {
  t.plan(2)
  t.is(currency.alt2scale('BAT'), '1e18')
  t.is(currency.alt2scale(), undefined)
})

test('get fiat 2 alt rate', async (t) => {
  t.plan(5)
  let result
  result = await currency.fiat2alt('USD', 5, 'BAT')
  t.true(_.isString(result))
  t.true(_.isNumber(+result))
  // make sure is integer
  t.true(parseInt(result) === +result)
  await t.throws(currency.fiat2alt('SSS', 1, 'BBB'))
  t.is(await currency.fiat2alt('USD', 0, 'BAT'), undefined)
})

test('get alt 2 fiat rate', async (t) => {
  t.plan(5)
  let result
  result = await currency.alt2fiat('BAT', 1, 'USD', true)
  t.true(_.isNumber(+result))
  t.true(result > 0)
  const resultA = result
  result = await currency.alt2fiat('BAT', 1e18, 'USD')
  t.true(_.isNumber(+result))
  t.is(result * 100, Math.round(resultA * 100))
  await t.throws(currency.alt2fiat('SSS', 1, 'BBB'))
})

test('capture exception is passed up to runtime', async (t) => {
  t.plan(1)
  const error = {}
  currency.runtime.captureException = (err) => {
    t.is(err, error)
  }
  currency.captureException(error)
})

test('rates are provided for basic tokens', async (t) => {
  const knownRateKeys = currency.knownRateKeys
  t.plan(2 + knownRateKeys.length)
  let result
  result = await currency.rates('BAT')
  t.true(_.isObject(result))
  t.true(knownRateKeys.length > 1)
  knownRateKeys.forEach((key) => {
    t.true(_.isNumber(result[key]))
  })
})
