import {
  serial as test
} from 'ava'

import uuidV4 from 'uuid/v4'

import {
  adsGrantsAvailable,
  getCohort,
  defaultCooldownHrs,
  cooldownOffset

} from './grants'

test('default cooldown hrs', async (t) => {
  t.is(defaultCooldownHrs(), defaultCooldownHrs(process.env.WALLET_COOLDOWN_HRS), 'uses env var for default')
  t.is(defaultCooldownHrs(12), 12, 'can be passed number')
  t.is(defaultCooldownHrs('12'), 12, 'can be passed numeric string')
  t.is(defaultCooldownHrs('0'), 0, 'can be passed falsey numeric string')
  t.is(defaultCooldownHrs('a'), 0, 'defaults to 0 if passed non numeric values')
})

test('cooldown offset', async (t) => {
  t.is(cooldownOffset(), cooldownOffset(defaultCooldownHrs()), 'calculates hours to offset in terms of milliseconds')
  t.is(cooldownOffset(12), 12 * 60 * 60 * 1000, 'gives back in ms')
  t.is(cooldownOffset({}), NaN, 'only takes numeric values')
})

test('adsGrantsAvailable does not allow ugp depending on the ip', async (t) => {
  t.false(await adsGrantsAvailable('JP'), 'this ip is not within the supported countries')
  t.true(await adsGrantsAvailable('US'), 'this ip is within the supported countries')
})

test('get cohort', async (t) => {
  t.throws(getCohort, Error, 'requires 3 arrays')
  t.throws(() => getCohort([]), Error)
  t.throws(() => getCohort([], []), Error)
  t.throws(() => getCohort([], [], []), Error, 'will err if no grants are passed')
  t.throws(() => getCohort([{ type: 'ads', grantId: uuidV4() }], [uuidV4()]), Error, 'will err if no grant is found')

  const grantId = uuidV4()
  const defaultCohorts = ['grant', 'ads', 'safetynet']

  t.is('grant', getCohort([{ type: 'ugp', grantId }], [grantId], defaultCohorts), 'if type is ugp, use grant')
  t.is('grant', getCohort([{ grantId }], [grantId], defaultCohorts), 'if type is empty, use grant')
  t.is('ads', getCohort([{ type: 'ads', grantId }], [grantId], defaultCohorts), 'if type is ads, use ads')
  t.is('safetynet', getCohort([{ type: 'android', grantId }], [grantId], defaultCohorts), 'if type is android, use safetynet')
  t.is('grant', getCohort([{ type: 'unknown', grantId }], [grantId], defaultCohorts), 'if type is unknown, use grant')

  const aGrantId = uuidV4()
  const bGrantId = uuidV4()
  const cGrantId = uuidV4()
  const aGrant = { type: 'grant', grantId: aGrantId }
  const bGrant = { type: 'ads', grantId: bGrantId }
  const cGrant = { type: 'safetynet', grantId: cGrantId }
  const abcGrants = [aGrant, bGrant, cGrant]
  t.is('ads', getCohort(abcGrants, [uuidV4(), bGrantId], defaultCohorts), 'finds matching grant out of many')
})
