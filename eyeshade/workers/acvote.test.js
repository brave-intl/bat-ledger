import test from 'ava'
import { insertVote } from './acvote.js'
import sinon from 'sinon'
import { Runtime } from 'bat-utils'
import config from '../../config.js'
import { v4 as uuidV4 } from 'uuid'
import utils from '../../test/utils.js'
import moment from 'moment'

test('should insert vote if it is valid', async (t) => {
  const channel = `youtube#channel:${uuidV4()}`
  const date = moment().format('YYYY-MM-DD')
  const example = {
    id: uuidV4(),
    type: 'a_vote',
    channel,
    createdAt: (new Date()).toISOString(),
    baseVoteValue: '0.25',
    voteTally: 10,
    fundingSource: 'uphold'
  }

  const tRuntime = new Runtime(config)
  const stubHasValidCountry = sinon.stub().returns(true)

  const preVoteCount = await utils.votes.voteCount(tRuntime)
  await insertVote(tRuntime, date, example, tRuntime.postgres, stubHasValidCountry)
  t.deepEqual((await utils.votes.voteCount(tRuntime)), preVoteCount + 1, 'Votes inserted')
})

test('should not insert vote if it is invalid', async (t) => {
  const channel = `youtube#channel:${uuidV4()}`
  const date = moment().format('YYYY-MM-DD')
  const example = {
    id: uuidV4(),
    type: 'a_vote2',
    channel,
    createdAt: (new Date()).toISOString(),
    baseVoteValue: '0.25',
    voteTally: 10,
    fundingSource: 'uphold2'
  }

  const tRuntime = new Runtime(config)
  const stubHasValidCountry = sinon.stub().returns(false)

  const preVoteCount = await utils.votes.voteCount(tRuntime)
  await insertVote(tRuntime, date, example, tRuntime.postgres, stubHasValidCountry)
  t.deepEqual((await utils.votes.voteCount(tRuntime)), preVoteCount, 'Votes not inserted')
})
