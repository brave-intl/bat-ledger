'use strict'

import batUtils from '../bat-utils'
import test from 'ava'
import dotenv from 'dotenv'
dotenv.config()
const braveHapi = batUtils.extras.hapi
const whitelist = batUtils.hapi.auth.whitelist
const Database = require('../bat-utils/lib/runtime-database')

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

test('bat-utils : database.form', async t => {
  const db = Database.prototype

  t.is(db.form({abc: 'def'}), 'abc_def')
  t.is(db.form({abc: 'def', foo: 'bar'}), 'abc_def_foo_bar')
  t.is(db.form({}), '')
})

test('bat-utils : database.gather', async t => {
  const db = Database.prototype
  const entry = {
    name: 'voting',
    property: 'surveyorId_1_publisher_1_cohort',
    unique: [ { surveyorId: 1, publisher: 1, cohort: 1 } ],
    others: [ { counts: 1 }, { timestamp: 1 },
              { exclude: 1 }, { hash: 1 }, { counts: 1 },
              { altcurrency: 1, probi: 1 },
              { altcurrency: 1, exclude: 1, probi: 1 },
              { owner: 1, altcurrency: 1, exclude: 1, probi: 1 },
              { publisher: 1, altcurrency: 1, exclude: 1, probi: 1 } ]
  }

  t.deepEqual(db.gather(entry), [
    'surveyorId_1_publisher_1_cohort_1',
    'counts_1',
    'timestamp_1',
    'exclude_1',
    'hash_1',
    'counts_1',
    'altcurrency_1_probi_1',
    'altcurrency_1_exclude_1_probi_1',
    'owner_1_altcurrency_1_exclude_1_probi_1',
    'publisher_1_altcurrency_1_exclude_1_probi_1'
  ])
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
    headers: {
      'x-forwarded-for': '127.0.0.1, 12.12.12.12'
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

  request = {
    headers: {
      'x-forwarded-for': ' '
    },
    info: {
      remoteAddress: '123.123.123.123'
    }
  }

  t.true(whitelist.ipaddr(request) === '123.123.123.123')
})
