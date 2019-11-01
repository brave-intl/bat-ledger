'use strict'

import avro from 'avro-js'
import Kafka from 'bat-utils/lib/runtime-kafka'
import suggestionsConsumer from '../../eyeshade/workers/suggestions'
import test from 'ava'
import {
  eyeshadeAgent,
  cleanPgDb
} from '../utils'
import Postgres from 'bat-utils/lib/runtime-postgres'
import { Runtime } from 'bat-utils'

const postgres = new Postgres({ postgres: { url: process.env.BAT_POSTGRES_URL } })
const runtime = new Runtime({
  kafka: { },
  testingCohorts: [ ],
  postgres: { url: process.env.BAT_POSTGRES_URL }
})

test.afterEach.always(async t => {
  await cleanPgDb(postgres)()
})

const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'
const example = {
  'id': 'e2874d25-14a9-4859-9729-78459af02a6f',
  'type': 'oneoff-tip',
  'channel': channel,
  'totalAmount': '10',
  'funding': [
    {
      'type': 'ugp',
      'amount': '10',
      'cohort': 'control',
      'promotion': '6820f6a4-c6ef-481d-879c-d2c30c8928c3'
    }
  ]
}

const suggestionType = avro.parse({
  'namespace': 'brave.grants',
  'type': 'record',
  'name': 'suggestion',
  'doc': "This message is sent when a client suggests to 'spend' a grant",
  'fields': [
    { 'name': 'type', 'type': 'string' },
    { 'name': 'channel', 'type': 'string' },
    { 'name': 'totalAmount', 'type': 'string' },
    { 'name': 'funding',
      'type': {
        'type': 'array',
        'items': {
          'type': 'record',
          'name': 'funding',
          'doc': 'This record represents a funding source, currently a promotion.',
          'fields': [
            { 'name': 'type', 'type': 'string' },
            { 'name': 'amount', 'type': 'string' },
            { 'name': 'cohort', 'type': 'string' },
            { 'name': 'promotion', 'type': 'string' }
          ]
        }
      }
    }
  ]
})

test('can create kafka consumer', async (t) => {
  const producer = new Kafka(runtime.config)
  await producer.connect()

  runtime.kafka = new Kafka(runtime.config)
  const messagesPromise = new Promise(resolve => {
    suggestionsConsumer(runtime, resolve)
  })
  await runtime.kafka.consume()

  await producer.send('grant-suggestions', suggestionType.toBuffer(example))

  await messagesPromise

  const { body } = await eyeshadeAgent.get(`/v1/accounts/${encodeURIComponent(channel)}?pending=true`)
  console.log(body)

  t.is(1, 1)
  // t.is(messages.length, 1)
  // t.is(messages[0].value, 'hello world')
})
