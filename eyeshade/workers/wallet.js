const bson = require('bson')
const underscore = require('underscore')
const { BigNumber } = require('bat-utils/lib/extras-utils')

const { votesId } = require('../lib/queries.js')

exports.name = 'wallet'
exports.initialize = async (debug, runtime) => {
}

exports.workers = {
/* sent by ledger POST /v1/registrar/persona/{personaId}

    { queue               : 'persona-report'
    , message             :
      { paymentId         : '...'
      , provider          : 'bitgo'
      , address           : '...'
      , keychains         :
        { user            : { xpub: '...', encryptedXprv: '...' }
        , backup          : { xpub: '...', encryptedXprv: '...' }
        }

      , addresses         : { BTC: '...', ... ]
      , altcurrency       : 'BAT'
      , httpSigningPubKey :
      }
    }
 */
  'persona-report':
    async (debug, runtime, payload) => {
      const paymentId = payload.paymentId
      const wallets = runtime.database.get('wallets', debug)

      const state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.extend({ paymentStamp: 0 }, underscore.omit(payload, ['paymentId']))
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

  /* sent by ledger POST /v1/surveyor/contribution
           ledger PATCH /v1/surveyor/contribution/{surveyorId}
           daily()

    { queue            : 'surveyor-report'
    , message          :
      { surveyorId     : '...'
      , surveyorType   : '...'
      , altcurrency    : '...'
      , probi          : ...
      , votes          : ...
      }
    }
 */
  'surveyor-report':
    async (debug, runtime, payload) => {
      const BATtoProbi = runtime.currency.alt2scale(payload.altcurrency)
      const { surveyorId } = payload
      const { postgres } = runtime

      const probi = payload.probi && new BigNumber(payload.probi.toString())
      const price = probi.dividedBy(BATtoProbi).dividedBy(payload.votes)

      await postgres.query('insert into surveyor_groups (id, price) values ($1, $2)', [surveyorId, price.toString()])
    },

  /* sent by PUT /v1/wallet/{paymentId}

    { queue              : 'contribution-report'
    , message            :
      { viewingId        : '...'
      , paymentId        : '...'
      , address          : '...'
      , paymentStamp     : ...
      , surveyorId       : '...'
      , altcurrency      : '...'
      , probi            : ...
      , fee              : ...
      , votes            : ...
      , hash             : '...'
      , cohort           : '...'
      }
    }
 */
  'contribution-report':
    async (debug, runtime, payload) => {
      const cohort = payload.cohort
      const paymentId = payload.paymentId
      const viewingId = payload.viewingId
      const contributions = runtime.database.get('contributions', debug)
      const wallets = runtime.database.get('wallets', debug)

      if (cohort && runtime.config.testingCohorts.includes(cohort)) {
        payload.probi = bson.Decimal128.fromString('0')
      } else {
        payload.probi = bson.Decimal128.fromString(payload.probi.toString())
      }
      payload.fee = bson.Decimal128.fromString(payload.fee.toString())
      const state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(payload, ['viewingId'])
      }
      await contributions.update({ viewingId: viewingId }, state, { upsert: true })

      state.$set = { paymentStamp: payload.paymentStamp }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

  /* sent by PUT /v1/surveyor/viewing/{surveyorId}

{ queue           : 'voting-report'
, message         :
  { surveyorId    : '...'
  , publisher     : '...'
  }
}
 */
  'voting-report':
    async (debug, runtime, payload) => {
      const { publisher, surveyorId } = payload
      const cohort = payload.cohort || 'control'
      const { postgres } = runtime

      if (!publisher) throw new Error('no publisher specified')

      const surveyorQ = await postgres.query('select frozen from surveyor_groups where id = $1 limit 1;', [surveyorId], true)
      if (surveyorQ.rowCount !== 1) {
        throw new Error('surveyor does not exist')
      }
      if (!surveyorQ.rows[0].frozen) {
        const update = `
        insert into votes (id, cohort, tally, excluded, channel, surveyor_id) values ($1, $2, 1, $3, $4, $5)
        on conflict (id) do update set updated_at = current_timestamp, tally = votes.tally + 1;
        `
        await postgres.query(update, [
          votesId(publisher, cohort, surveyorId),
          cohort,
          runtime.config.testingCohorts.includes(cohort),
          publisher,
          surveyorId
        ])
      }
    },

  /* sent when the wallet balance updates

    { queue            : 'wallet-report'
    , message          :
      { paymentId      : '...'
      , balances       : { ... }
      }
    }
 */
  'wallet-report':
    async (debug, runtime, payload) => {
      const paymentId = payload.paymentId
      const wallets = runtime.database.get('wallets', debug)

      underscore.keys(payload.balances).forEach((key) => {
        payload.balances[key] = bson.Decimal128.fromString(payload.balances[key])
      })
      const state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: { balances: payload.balances }
      }
      await wallets.update({ paymentId: paymentId }, state, { upsert: true })
    },

  /* sent by PUT /v1/wallet/{paymentId} (if one or more grants are redeemed)

{ queue           : 'redeem-report'
, message         :
  { grantIds      : '...'
  , redeemed      : { ... }
  }
}
 */
  'redeem-report':
    async (debug, runtime, payload) => {
      const grantIds = payload.grantIds
      const grants = runtime.database.get('grants', debug)

      const state = {
        $currentDate: { timestamp: { $type: 'timestamp' } },
        $set: underscore.omit(payload, ['grantIds'])
      }
      await grants.update({ grantId: { $in: grantIds } }, state, { upsert: true })
    }
}
