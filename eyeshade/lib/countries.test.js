import { serial as test } from 'ava'
import countries from './countries.js'

test('countries should not have duplicated values', (t) => {
  const now = +(new Date())
  const now0 = new Date(now)
  const now1 = new Date(now + 1)
  const now2 = new Date(now + 2)
  const scenarios = [{
    // countries can appear in multiple groups
    // but will only show up once after resolution
    input: [
      { id: 'a', activeAt: now0, codes: ['us', 'uk', 'fr'] },
      { id: 'b', activeAt: now1, codes: ['uk', 'jp'] },
      { id: 'c', activeAt: now1, codes: ['us', 'de'] },
      { id: 'd', activeAt: now2, codes: ['jp'] }
    ],
    expected: [
      { id: 'a', activeAt: now0, codes: ['fr'] },
      { id: 'b', activeAt: now1, codes: ['uk'] },
      { id: 'c', activeAt: now1, codes: ['us', 'de'] },
      { id: 'd', activeAt: now2, codes: ['jp'] }
    ]
  }, {
    // a new group will win out
    input: [
      { id: 'a', activeAt: now0, codes: ['us', 'uk', 'fr'] },
      { id: 'b', activeAt: now1, codes: ['uk'] }
    ],
    expected: [
      { id: 'a', activeAt: now0, codes: ['us', 'fr'] },
      { id: 'b', activeAt: now1, codes: ['uk'] }
    ]
  }, {
    // but an old group will not
    input: [
      { id: 'a', activeAt: now1, codes: ['us', 'uk', 'fr'] },
      { id: 'b', activeAt: now0, codes: ['uk'] }
    ],
    expected: [
      { id: 'a', activeAt: now1, codes: ['us', 'uk', 'fr'] }
    ]
  }]
  t.plan(scenarios.length)
  for (let i = 0; i < scenarios.length; i += 1) {
    const { input, expected } = scenarios[i]
    const resolved = countries.resolve(input)
    t.deepEqual(resolved, expected, `scenario ${i} should be predictable`)
  }
})
