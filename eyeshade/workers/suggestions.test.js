const test = require('ava')
const { handleMessage } = require('./suggestions.js')
const sinon = require('sinon')
const { Runtime } = require('bat-utils')
const config = require('../../config')
const { v4: uuidV4 } = require('uuid')
const utils = require('../../test/utils')
const channel = 'youtube#channel:UC2WPgbTIs9CDEV7NpX0-ccw'

test('should insert vote if it is valid', async (t) => {
  const tRuntime = new Runtime(config)
  const stubHasValidCountry = sinon.stub().returns(true)

  const example = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '10',
    funding: [
      {
        type: 'ugp',
        amount: '10',
        cohort: 'control',
        promotion: uuidV4()
      }
    ]
  }

  const preVoteCount = await utils.votes.voteCount(tRuntime)
  await handleMessage(tRuntime, example, tRuntime.postgres, stubHasValidCountry)
  t.deepEqual((await utils.votes.voteCount(tRuntime)), preVoteCount + 1, 'Votes inserted')
})

test('should not insert vote if it is invalid', async (t) => {
  const tRuntime = new Runtime(config)
  const stubHasValidCountry = sinon.stub().returns(false)

  const example = {
    id: uuidV4(),
    type: 'oneoff-tip',
    channel,
    createdAt: (new Date()).toISOString(),
    totalAmount: '10',
    funding: [
      {
        type: 'ugp',
        amount: '10',
        cohort: 'control',
        promotion: uuidV4()
      }
    ]
  }

  const preVoteCount = await utils.votes.voteCount(tRuntime)
  await handleMessage(tRuntime, example, tRuntime.postgres, stubHasValidCountry)
  t.deepEqual((await utils.votes.voteCount(tRuntime)), preVoteCount, 'Votes not inserted')
})
