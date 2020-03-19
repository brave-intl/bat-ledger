'use strict'

const braveHapi = require('./extras-hapi.js')
const test = require('ava')
const dotenv = require('dotenv')
dotenv.config()

test('isSimpleTokenValid', async t => {
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
