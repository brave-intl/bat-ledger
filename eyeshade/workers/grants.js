const { insertGrant } = require('../lib/grants')
const { transaction } = require('../lib/queries')

const workers = {
  'grant-suggestion-report': grantReport
}

module.exports = {
  workers,
  initialize: async (debug, runtime) => {
    await runtime.queue.create('grant-suggestion-report')
  }
}

/* sent by grant server

    { queue            : 'grant-suggestion-report'
    , message          :
      [
        { id          : UUID
        , promotionId : UUID
        , createdAt   : Date
        , type        : string
        , amount      : unsigned int
        , cohort      : string
        , channel     : string
        }
      ]
    }
*/
async function grantReport (debug, runtime, grants) {
  const { postgres } = runtime
  await transaction({
    debug,
    postgres,
    runner
  })

  async function runner (client) {
    for (let grant of grants) {
      await insertGrant({
        postgres,
        client,
        grant
      })
    }
  }
}
