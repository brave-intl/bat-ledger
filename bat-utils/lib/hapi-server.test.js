'use strict'

const Server = require('./hapi-server')
const test = require('ava')
const dotenv = require('dotenv')
const supertest = require('supertest')
dotenv.config()

test('hapi throws', async (t) => {
  const message = 'failed in throwing test'

  const runtime = {
    config: { server: {} },
    notify: () => {},
    captureException: (err, extra) => {
      t.is(err.message, message)
    }
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
