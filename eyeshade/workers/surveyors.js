const { insertFromVoting, updateBalances } = require('../lib/transaction.js')
const { mixer } = require('../workers/reports.js')
const { createdTimestamp } = require('bat-utils/lib/extras-utils')

exports.initialize = async (debug, runtime) => {
  await runtime.queue.create('surveyor-frozen-report')
}

exports.workers = {
/* sent by freezeOldSurveyors

    { queue            : 'surveyor-frozen-report'
    , message          :
      { surveyorId  : '...'
      , mix         : false
      }
    }
*/
  'surveyor-frozen-report':
    async (debug, runtime, payload) => {
      const voting = runtime.database.get('voting', debug)
      const surveyors = runtime.database.get('surveyors', debug)
      const { mix, surveyorId } = payload

      const surveyor = await surveyors.findOne({ surveyorId })

      if (mix) {
        await mixer(debug, runtime, undefined, undefined)
      }

      const docs = await voting.aggregate([
        {
          $match: { probi: { $gt: 0 }, exclude: false, surveyorId }
        },
        {
          $group: {
            _id: { publisher: '$publisher', altcurrency: '$altcurrency' },
            probi: { $sum: '$probi' },
            fees: { $sum: '$fees' }
          }
        }
      ])

      const client = await runtime.postgres.pool.connect()
      try {
        await client.query('BEGIN')
        try {
          for (let doc of docs) {
            await insertFromVoting(runtime, client, Object.assign(doc, { surveyorId }), createdTimestamp(surveyor._id))
          }
        } catch (e) {
          await client.query('ROLLBACK')
          runtime.captureException(e, { extra: { report: 'surveyor-frozen-report', surveyorId } })
          throw e
        }

        await updateBalances(runtime, client)
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
}
