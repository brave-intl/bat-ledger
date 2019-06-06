'use strict'

import {
  forwardedIPShift,
  ipaddr
} from './hapi-auth-whitelist.js'
import {
  serial as test
} from 'ava'

import dotenv from 'dotenv'
dotenv.config()

test('ipaddr', (t) => {
  t.is(ipaddr(req('123.123.123.123', '127.0.0.1,12.12.12.12')), '12.12.12.12')
  t.is(ipaddr(req('123.123.123.123', '127.0.0.1, 12.12.12.12')), '12.12.12.12')
  t.is(ipaddr(req('123.123.123.123')), '123.123.123.123')
  t.is(ipaddr(req('123.123.123.123', ' ')), '123.123.123.123')
})

test('ipaddr can be shifted', async (t) => {
  await munge('FORWARDED_IP_SHIFT', (set) => {
    t.is(ipaddr(req('', '0.0.0.0,8.8.8.8,9.0.0.0')), '9.0.0.0', 'by default the last ip is taken')
    set('2')
    t.is(ipaddr(req('', '0.0.0.0,8.8.8.8,9.0.0.0')), '8.8.8.8', 'by changing the env, you can choose which ip in the list of forwarded ips to take by default')
  })
})

test('shift amount can be retrieved', async (t) => {
  await munge('FORWARDED_IP_SHIFT', (set) => {
    t.is(forwardedIPShift(), 1, 'by default it is one')
    set('3')
    t.is(forwardedIPShift(), 3, 'but can be overwritten')
    set('what')
    t.throws(forwardedIPShift, Error, 'non numeric values throw')
    set('-2')
    t.is(forwardedIPShift(), 1, 'negative numbers are clamped to 1')
  })
})

function req (remoteAddress, XForwardedFor) {
  return {
    headers: XForwardedFor ? {
      'x-forwarded-for': XForwardedFor
    } : {},
    info: {
      remoteAddress
    }
  }
}

async function munge (key, handler) {
  const cachedEnv = process.env[key]
  await handler(set)
  set(cachedEnv)

  function set (value) {
    if (value) {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
}
