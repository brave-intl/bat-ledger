import {
  serial as test
} from 'ava'
import _ from 'underscore'
import uuid from 'uuid'
import {
  ok,
  status,
  cleanDbs,
  braveYoutubePublisher,
  braveYoutubeOwner,
  eyeshadeAgent
} from '../utils'
import {
  removeReferral
} from '../../eyeshade/controllers/referrals'
import {
  Runtime
} from 'bat-utils'

const runtime = Runtime({
  postgres: {
    url: process.env.BAT_POSTGRES_URL
  }
})
const {
  BigNumber
} = runtime.currency

test.after(cleanDbs)

const url = (id) => `/v1/referrals/${id}`

test('404s when transaction does not exist', async t => {
  t.plan(0)

  const id = uuid.v4()

  await eyeshadeAgent
    .get(url(id))
    .expect(status(404))
})

test('can add a referral', async t => {
  t.plan(5)
  const id = uuid.v4().toLowerCase()
  const uri = url(id)
  const referrals = [{
    ownerId: braveYoutubeOwner,
    channelId: braveYoutubePublisher
  }]

  const {
    body: inserted
  } = await eyeshadeAgent
    .put(uri)
    .send(referrals)
    .expect(ok)

  const {
    body
  } = await eyeshadeAgent
    .get(uri)
    .expect(ok)

  t.deepEqual(inserted, body)
  const ratio = await runtime.currency.ratio('fiat/USD', 'alt/BAT')
  const one = inserted[0]
  const amount = new BigNumber(ratio).times(5)
  t.true(amount.toString() > 0, 'probi are recorded')
  t.is(inserted.length, 1, 'only one transaction inserted')
  t.is(amount.round().toString(), new BigNumber(one.amount).round().toString(), '$5 in bat are transferred')
  const subset = _.omit(one, ['amount'])
  t.deepEqual(subset, {
    channelId: braveYoutubePublisher,
    ownerId: braveYoutubeOwner,
    transactionId: id
  }, 'transaction is recorded')
  await removeReferral(runtime, id)
})

test('does not allow duplicate referrals when transactionId is same', async (t) => {
  t.plan(0)
  const id = uuid.v4()
  const uri = url(id)
  const referrals = [{
    ownerId: braveYoutubeOwner,
    channelId: braveYoutubePublisher
  }]

  await eyeshadeAgent
    .put(uri)
    .send(referrals)
    .expect(ok)

  await eyeshadeAgent
    .put(uri)
    .send(referrals)
    .expect(status(422))

  await removeReferral(runtime, id)
})
