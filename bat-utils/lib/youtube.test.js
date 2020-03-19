'use strict'
const test = require('ava')
const getYoutubeChannelId = require('./youtube')

test.skip('retrieves the youtube channel id for a youtube username', async t => {
  const youtubeUsername = 'SaturdayNightLive'
  const expectedChannelId = 'UCqFzWxSCi39LnW1JKFR3efg'
  const retrievedChannelId = (await getYoutubeChannelId(youtubeUsername))

  t.true(retrievedChannelId === expectedChannelId)
})

test.skip('returns null for a non existant youtube usernname', async t => {
  const fakeYoutubeUsername = '431a203d92969fb7d9009f4d975'
  const expectedChannelId = null
  const retrievedChannelId = (await getYoutubeChannelId(fakeYoutubeUsername))

  t.true(retrievedChannelId === expectedChannelId)
})
