'use strict'

import batUtils from '../bat-utils'
import test from 'ava'
const braveHapi = batUtils.extras.hapi
const whitelist = batUtils.hapi.auth.whitelist

test('bat-utils : isSimpleTokenValid', async t => {
  t.false(braveHapi.isSimpleTokenValid([], ''))
  t.false(braveHapi.isSimpleTokenValid(['foo'], 'bar'))
  t.false(braveHapi.isSimpleTokenValid(['foo'], 'foobar'))
  t.false(braveHapi.isSimpleTokenValid(['foobar'], 'foo'))

  t.true(braveHapi.isSimpleTokenValid(['foo'], 'foo'))
  t.true(braveHapi.isSimpleTokenValid(['foo', 'bar'], 'foo'))
  t.true(braveHapi.isSimpleTokenValid(['foo', 'bar'], 'bar'))

  t.throws(() => {
    braveHapi.isSimpleTokenValid('foo', 'bar')
  })
  t.throws(() => {
    braveHapi.isSimpleTokenValid(['foo'], ['bar'])
  })
})

test('bat-utils : ipaddr', async t => {
  let request = {
    headers: {
      'x-forwarded-for': '127.0.0.1,12.12.12.12'
    },
    info: {
      remoteAddress: '123.123.123.123'
    }
  }

  t.true(whitelist.ipaddr(request) === '12.12.12.12')

  request = {
    headers: {},
    info: {
      remoteAddress: '123.123.123.123'
    }
  }

  t.true(whitelist.ipaddr(request) === '123.123.123.123')
})
