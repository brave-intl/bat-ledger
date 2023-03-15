import test from 'ava'
import _ from 'underscore'
import Postgres from './runtime-postgres.js'
import { v4 as uuidV4 } from 'uuid'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

const postgres = new Postgres({
  postgres: {
    connectionString: process.env.DATABASE_URL
  }
})

test('instantiates correctly', (t) => {
  t.true(_.isObject(postgres))
})

test('executes queries', async (t) => {
  const id = uuidV4()
  const { rows } = await postgres.query(`
  insert into surveyor_groups (id, price, frozen, virtual)
  values ($1, $2, $3, $4)
  returning *`, [
    id,
    '0.25',
    'false',
    'true'
  ])
  t.is(rows.length, 1)
  const { rows: gotten } = await postgres.query(`
  select * from surveyor_groups
  where id = $1`, [id])
  t.deepEqual(rows, gotten)
})
