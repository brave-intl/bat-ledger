const transaction = require('../lib/transaction')
const { normalizeChannel, BigNumber } = require('bat-utils/lib/extras-utils')
const { ObjectID } = require('bson')
const settlements = require('../lib/settlements')

module.exports = {
  consumer,
  insertMessage
}

function consumer (runtime) {
  const { kafka } = runtime
  kafka.on(settlements.topic, async (messages, client) => {
    const inserting = {}
    await kafka.mapMessages(settlements, messages, async (settlement, timestamp) => {
      return insertMessage(inserting, runtime, settlement, timestamp, client)
    })
  })
}

async function insertMessage (inserting, runtime, settlement, timestamp, client) {
  const { postgres } = runtime
  const {
    publisher,
    settlementId,
    documentId,
    altcurrency,
    currency,
    address,
    probi,
    amount,
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
  const {
    rows: inserted
  } = await postgres.query('select * from transactions where id = $1', [id], client)
  if (inserted.length) {
    return
  }
  await transaction.insertFromSettlement(runtime, client, {
    _id: ObjectID.createFromTime(+(new Date(timestamp)) / 1000),
    publisher,
    address,
    settlementId,
    altcurrency,
    currency,
    documentId,
    probi: new BigNumber(probi),
    amount: new BigNumber(amount),
    fees: new BigNumber(fees),
    type,
    owner
  })
}
