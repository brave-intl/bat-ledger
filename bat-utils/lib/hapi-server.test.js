'use strict'

import Server from './hapi-server'
import Cache from './runtime-cache'
import hapiControllersIndex from './hapi-controllers-index'
import test from 'ava'
import dotenv from 'dotenv'
import supertest from 'supertest'
dotenv.config()

// const config = require('../../config')

const runtime = {
  // config,
  notify: () => {},
  captureException: () => {},
  cache: new Cache({
    cache: {
      redis: process.env.REDIS_URL || 'redis://localhost:6379'
    }
  })
}

test.skip('hapi throws', async (t) => {
  const server = await Server({
    routes: hapiControllersIndex,
    id: 'a'
  }, runtime)
  const message = 'failed in throwing test'
  let result = false

  server.route({
    method: 'GET',
    path: '/throwing-test',
    handler: (request, reply) => {
      reply(new Error(message))
    }
  })
  server.inject('/throw', (res) => {
    result = true
  })
  await supertest(server.listener).get('/throwing-test').send().expect(500)
  t.true(result)
  console.log('result', result)
  await server.stop({
    timeout: 1
  })
  console.log('finished')
})
