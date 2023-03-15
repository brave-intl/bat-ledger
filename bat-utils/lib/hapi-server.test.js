'use strict'

import Server from './hapi-server.js'
import test from 'ava'
import Cache from './runtime-cache.js'
import supertest from 'supertest'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

test('hapi throws', async (t) => {
  const message = 'failed in throwing test'

  const runtime = {
    config: { server: {} },
    notify: () => {},
    captureException: (err, extra) => {
      t.is(err.message, message)
    },
    cache: new Cache({
      cache: {
        redis: {
          url: process.env.BAT_REDIS_URL || 'redis://localhost:6379'
        }
      }
    })
  }

  const server = await Server({
    id: 'a',
    routes: {
      routes: async () => {
        return {
          method: 'GET',
          path: '/throwing-test',
          handler: async (request, h) => {
            throw new Error(message)
          }
        }
      }
    }
  }, runtime)

  await supertest(server.listener).get('/throwing-test').send().expect(500)

  await server.stop({
    timeout: 1
  })
})
