const { serial: test } = require('ava')
const countries = require('./countries')

test('countries should not have duplicated values', (t) => {
  const now = +(new Date())
  const scenarios = [{
    input: [{
      groupId: 'a',
      activeAt: new Date(now),
      codes: ['us', 'uk', 'fr']
    }, {
      groupId: 'b',
      activeAt: new Date(now + 1),
      codes: ['uk']
    }],
    expected: [{
      groupId: 'a',
      codes: ['us', 'fr']
    }, {
      groupId: 'b',
      codes: ['uk']
    }]
  }]
  for (let i = 0; i < scenarios.length; i += 1) {
    t.deepEqual(countries.resolve(scenarios[i].input), scenarios[i].expected, `scenario ${i} should be predictable`)
  }
})
