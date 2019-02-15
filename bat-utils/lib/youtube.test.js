'use strict'
import test from 'ava'
import getYoutubeChannelId from './youtube'

test('retrieves the youtube channel id for a youtube username', async t => {
  const youtubeUsername = 'SaturdayNightLive'
  const expectedChannelId = 'UCqFzWxSCi39LnW1JKFR3efg'
  const retrievedChannelId = (await getYoutubeChannelId(youtubeUsername))

  t.true(retrievedChannelId === expectedChannelId)
})
