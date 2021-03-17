const test = require('ava')
const _ = require('underscore')
const Postgres = require('./runtime-postgres')
const { v4: uuidV4 } = require('uuid')
const dotenv = require('dotenv')
dotenv.config()

const postgres = new Postgres({
  postgres: {
    url: process.env.DATABASE_URL
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

test('batching inserts', async (t) => {
  const query = `insert into surveyor_groups (id, price, frozen, virtual)
  values` // this is the important part
  const rows = [...new Array(20)].map(() => ([
    uuidV4(),
    '0.25',
    false,
    true
  ]))
  const { rows: inserted } = await postgres.insert(query, rows, { returnResults: true })
  const ids = rows.map((row) => row[0])
  const { rows: gotten } = await postgres.query(`select * from surveyor_groups
  where id = any($1::text[])`, [ids])
  t.is(20, gotten.length)
  t.deepEqual(inserted, gotten)
})

test('prepInsert', async (t) => {
  const input = [
    ['a'],
    undefined,
    ['b', 2],
    null,
    ['c', 3, uuidV4()]
  ]
  const transformed = postgres.prepInsert(input)
  t.deepEqual(transformed, [
    ['a', undefined, undefined],
    ['b', 2, undefined],
    ['c', 3, input[4][2]]
  ])
})
