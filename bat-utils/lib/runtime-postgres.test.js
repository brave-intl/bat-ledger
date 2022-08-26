const test = require('ava')
const _ = require('underscore')
const Postgres = require('./runtime-postgres')
const { v4: uuidV4 } = require('uuid')
const dotenv = require('dotenv')
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
