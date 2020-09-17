const {
  insertFromSettlement,
  settlementId: createSettlementId
} = require('../lib/transaction')
const { normalizeChannel } = require('bat-utils/lib/extras-utils')
const { eachMessage } = require('./utils')
const settlements = require('../lib/settlements')

module.exports = {
  consumer
}

function consumer (runtime) {
  runtime.kafka.on(settlements.topic, async (messages, client) => {
    const inserting = {}
    await eachMessage(runtime, settlements, messages, async ({
      createdAt,
      publisher,
      settlementId,
      altcurrency,
      probi,
      fees,
      type,
      owner
    }) => {
      const normalizedChannel = normalizeChannel(publisher)
      const id = createSettlementId(settlementId, normalizedChannel)
      if (inserting[id]) {
        return
      }
      inserting[id] = true
      await insertFromSettlement(runtime, client, {
        _id: createdAt,
        publisher,
        settlementId,
        altcurrency,
        probi,
        fees,
        type,
        owner
      })
    })
  })
}
