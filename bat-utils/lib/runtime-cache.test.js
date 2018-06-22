'use strict'

import { serial as test } from 'ava'
import dotenv from 'dotenv'
import Cache from './runtime-cache'
import { v4 } from 'uuid'

dotenv.config()

const cache = Cache.create()

test('cache.connects', async t => {
  t.plan(0)
  await cache.connected()
})

test('cache.accessor', (t) => {
  t.plan(4)
  const key = 'one'
  const prefix = 'two'
  t.is(cache.accessor(key, prefix), `${prefix}:${key}`)
  t.is(cache.accessor(null, prefix), `${prefix}:${null}`)
  t.is(cache.accessor(key), key)
  t.is(cache.accessor(), undefined)
})

const key = v4()
const unique = v4()
// this can all be done without prefixes
runDelGetSet()
// prefixed does not collide with non prefixed
runDelGetSet('prefixed')

function runDelGetSet (prefix, performCollideCheck) {
  const stringPrefix = JSON.stringify(prefix)
  test(`cache.get and .set and .del with prefix ${stringPrefix}`, async (t) => {
    t.plan(3)
    t.is(await cache.get(key, prefix), null)
    const stringifiedSet = JSON.stringify({
      unique
    })
    await cache.set(key, stringifiedSet, null, prefix)
    const previouslySet = await cache.get(key, prefix)
    const parsedSet = JSON.parse(previouslySet)
    t.deepEqual(parsedSet, {
      unique
    })
    cache.del(key, prefix)
    t.is(await cache.get(key, prefix), null)
  })
}

test('quit', async (t) => {
  t.plan(0)
  await cache.quit()
})
