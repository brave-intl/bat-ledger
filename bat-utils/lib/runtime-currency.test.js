'use strict'

import Currency from './runtime-currency.js'
import { BigNumber, timeout } from './extras-utils.js'
import test from 'ava'
import _ from 'underscore'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

const currency = make(Currency)

test('instantiates correctly', (t) => {
  t.plan(1)
  t.true(_.isObject(currency))
})

test('get the ratio', async (t) => {
  t.plan(2)
  const result = await currency.ratio('BAT', 'USD')
  t.true(_.isObject(result))
  t.true(_.isNumber(+result.bat.usd))
})

test('get decimal scale', async (t) => {
  t.plan(2)
  t.is(currency.alt2scale('BAT'), '1e18')
  t.is(currency.alt2scale(), undefined)
})

test('get fiat 2 alt rate', async (t) => {
  t.plan(5)
  const result = await currency.fiat2alt('USD', 5, 'BAT')
  t.true(_.isString(result))
  t.true(_.isNumber(+result))
  // make sure is integer
  t.true(parseInt(result) === +result)
  await t.throwsAsync(currency.fiat2alt('SSS', 1, 'BBB'), { instanceOf: Error })
  t.is(await currency.fiat2alt('USD', 0, 'BAT'), undefined)
})

test('get alt 2 fiat rate', async (t) => {
  t.plan(4)
  let resultNumber
  resultNumber = await currency.alt2fiat('BAT', 1, 'USD', true)
  resultNumber = new BigNumber(resultNumber)
  t.true(_.isNumber(+resultNumber))
  t.true(resultNumber > 0)
  resultNumber = await currency.alt2fiat('BAT', 1, 'USD')
  resultNumber = new BigNumber(resultNumber)
  const noDecimal = resultNumber.times(100)
  t.is(+noDecimal, Math.round(+noDecimal))
  await t.throwsAsync(currency.alt2fiat('SSS', 1, 'BBB'), { instanceOf: Error })
})

test('capture exception is passed up to runtime', async (t) => {
  t.plan(1)
  const error = {
    ignore: true
  }
  currency.runtime.captureException = (err) => {
    t.is(err, error)
  }
  currency.captureException(error)
  delete currency.runtime.captureException
})

test('make sure cache is caching', async (t) => {
  t.plan(1)
  const oldCache = currency.cache
  const trueResult = await currency.ratio('BAT', 'USD')
  const ones = _.mapObject(trueResult, () => '1')
  const oneResult = {
    lastUpdated: (new Date()).toISOString(),
    payload: Object.assign({}, ones, {
      bat: '1'
    })
  }
  const createCache = (context) => ({
    set: () => {},
    get: (key) => oneResult
  })
  currency.cache = createCache({})
  const result = await currency.ratio('BAT', 'USD')
  t.deepEqual(ones, result)
  currency.cache = oldCache
})

test('a faulty request does not result in an error', async (t) => {
  t.plan(2)
  const currency = make(Currency.Constructor)
  currency.cache = currency.Cache()
  currency.parser = () => { throw new Error('missed') }
  // throwing with no cache
  try {
    await currency.ratio('BAT', 'USD')
  } catch (e) {
    t.true(_.isObject(e))
  }
  // caching
  delete currency.parser
  const res1 = await currency.ratio('BAT', 'USD')
  let res2 = null
  try {
    res2 = await currency.ratio('BAT', 'USD')
  } catch (e) {
    t.true(false)
  }
  t.deepEqual(res1, res2)
  currency.cache = currency.Cache()
})

test('a faulty request delays subsequent requests', async (t) => {
  const currency = make(Currency.Constructor, {
    lastFailure: 5000
  })
  const first = await currency.ratio('BAT', 'USD')
  currency.parser = () => { throw new Error('missed') }
  currency.request = _.wrap(currency.request, (request, endpoint) => {
    return request.call(currency, endpoint)
  })
  t.deepEqual(first, await currency.ratio('BAT', 'USD'))
  await timeout(6000)
  t.deepEqual(first, await currency.ratio('BAT', 'USD'))
  currency.cache = currency.Cache()
  try {
    await currency.ratio('BAT', 'USD')
  } catch (e) {
    t.true(_.isObject(e))
  }
})

function make (Constructor = Currency, options = {}) {
  return new Constructor({
    currency: Object.assign({
      url: process.env.BAT_RATIOS_URL,
      access_token: process.env.BAT_RATIOS_TOKEN
    }, options)
  }, {
    captureException: () => {}
  })
}
