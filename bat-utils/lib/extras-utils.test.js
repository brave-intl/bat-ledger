'use strict'
import test from 'ava'
import {
  ObjectID
} from 'mongodb'
import {
  surveyorChoices,
  createdTimestamp,
  timeout,
  parsePlatform,
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

test('surveyorChoices', (t) => {
  t.plan(4)
  t.deepEqual(surveyorChoices(0.55), [6, 10, 14, 20, 40], 'increment is less than')
  t.deepEqual(surveyorChoices(0.5), [6, 10, 14, 20, 40], 'increment is equal to')
  t.deepEqual(surveyorChoices(2), [3, 5, 7, 10, 20], 'increment can be above range')
  t.deepEqual(surveyorChoices(0.02), [30, 50, 70, 100], 'increment can be below range')
})

test('parsePlatform', (t) => {
  t.plan(8)
  // ['other', 'chrome']
  t.is('other', parsePlatform('Mozilla/5.0 (X11; U; CrOS i686 9.10.0; en-US) AppleWebKit/532.5 (KHTML, like Gecko) Chrome/4.0.253.0 Safari/532.5'))
  // ['windows', 'other']
  t.is('other', parsePlatform('Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:47.0) Gecko/20100101 Firefox/47.0'))
  t.is('android', parsePlatform('Mozilla/5.0 (Linux; Android 8.0.0; SM-G960F Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.84 Mobile Safari/537.36'))
  t.is('mac', parsePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.75 Safari/537.36'))
  t.is('android', parsePlatform('Mozilla/5.0 (Linux; Android 4.0.4; Galaxy Nexus Build/IMM76B) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.133 Mobile Safari/535.19'))
  t.is('ios', parsePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/69.0.3497.105 Mobile/15E148 Safari/605.1'))
  t.is('linux', parsePlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'))
  t.is('ios', parsePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 13_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/14.0b12646 Mobile/15E148 Safari/605.1.15'))
})
