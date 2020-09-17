const transaction = require('../lib/transaction')
const { normalizeChannel, BigNumber } = require('bat-utils/lib/extras-utils')
const { eachMessage } = require('./utils')
const settlements = require('../lib/settlements')

module.exports = {
  consumer
}

function consumer (runtime) {
  runtime.kafka.on(settlements.topic, async (messages, client) => {
    const inserting = {}
    await eachMessage(runtime, settlements, messages, async (settlement) => {
      const {
        createdAt,
        publisher,
        settlementId,
        altcurrency,
        address,
        probi: probiString,
        fees,
        type,
        owner
      } = settlement
      const normalizedChannel = normalizeChannel(publisher)
      const id = transaction.id.settlement(settlementId, normalizedChannel, type)
      if (inserting[id]) {
        return
      }
      inserting[id] = true
      const scale = runtime.currency.alt2scale(altcurrency)
      const probi = new BigNumber(probiString)
      // amount is a duplicate value. should discuss removing
      const amount = probi.dividedBy(scale)
      const {
        rows: inserted
      } = await runtime.postgres.query('select * from transactions where id = $1', [id], client)
      if (inserted.length) {
        return
      }
      await transaction.insertFromSettlement(runtime, client, {
        _id: new Date(createdAt),
        publisher,
        address,
        settlementId,
        altcurrency,
        probi,
        amount,
        fees: new BigNumber(fees),
        type,
        owner
      })
    })
  })
}
