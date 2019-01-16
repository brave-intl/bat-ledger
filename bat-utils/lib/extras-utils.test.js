'use strict'
import test from 'ava'
import {
  ObjectID
} from 'mongodb'
import {
  bottlenecks,
  createdTimestamp,
  timeout,
  documentOlderThan,
  isYoutubeChannelId,
  normalizeChannel
} from './extras-utils'

import dotenv from 'dotenv'
dotenv.config()

const objectId = ObjectID('5b11685dd28b11258d50c1f4')
const objectDate = (new Date('2018-06-01T15:38:05.000Z')).getTime()
test('createdTimestamp', (t) => {
  t.plan(1)
  const fromId = createdTimestamp(objectId)
  t.is(fromId, objectDate)
})

test('timeout', (t) => {
  t.plan(1)
  let bool = false
  timeout(495).then(() => {
    bool = true
  })
  const justRight = timeout(500).then(() => {
    t.true(bool)
  })
  const tooLate = timeout(505).then(() => {
    throw new Error('bad timeout')
  })
  return Promise.race([
    justRight,
    tooLate
  ])
})

test('documentOlderThan', (t) => {
  t.plan(3)
  t.true(documentOlderThan(-1, objectDate, objectId))
  t.false(documentOlderThan(1, objectDate, objectId))
  // lt not lte
  t.false(documentOlderThan(0, objectDate, objectId))
})

test('isYoutubeChannelId', (t) => {
  t.plan(3)
  t.true(isYoutubeChannelId('UCFNTTISby1c_H-rm5Ww5rZg'))
  t.false(isYoutubeChannelId('UCFNTTISby1c_H-rm5Ww5rZ'))
  t.false(isYoutubeChannelId('Brave'))
})

test('normalizeChannel', (t) => {
  t.plan(4)
  t.is(normalizeChannel('youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg'), 'youtube#channel:UCFNTTISby1c_H-rm5Ww5rZg')
  t.is(normalizeChannel('youtube#channel:Brave'), 'youtube#user:Brave')
  t.is(normalizeChannel('twitch#channel:Brave'), 'twitch#author:Brave')
  t.is(normalizeChannel('www.brave.com'), 'www.brave.com')
})

test('bottlenecks exist', async (t) => {
  t.plan(4)
  const time = 500
  const limit = 320
  const poolLimit = 64
  const minimumBuffer = (limit / poolLimit) * time
  const btlnecks = bottlenecks.createBottlenecks({
    clientOptions: {
      url: process.env.BAT_REDIS_URL
    }
  })

  await tests(minimumBuffer, () => {
    return btlnecks.ledger.schedule(request)
  })
  await tests(0, request)

  async function tests (buffer, fn) {
    const start = new Date()
    const end = await rundown(limit, fn)
    t.true(end >= +start + buffer)
    t.true(end < +start + buffer + 1000)
  }

  async function rundown (limit, fn) {
    let count = 0
    const list = []
    while (count < limit) {
      count += 1
      list.push(fn(count))
    }
    await Promise.all(list)
    return new Date()
  }

  function request (count) {
    return timeout(time)
  }
})
