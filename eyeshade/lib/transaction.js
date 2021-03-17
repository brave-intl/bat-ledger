const { getPublisherProps } = require('bat-utils/lib/extras-publisher')
const { v5: uuidv5 } = require('uuid')
const {
  createdTimestamp,
  BigNumber,
  normalizeChannel
} = require('bat-utils/lib/extras-utils')

const knownChains = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  LTC: 'litecoin'
}
const SETTLEMENT_NAMESPACE = {
  contribution: '4208cdfc-26f3-44a2-9f9d-1f6657001706',
  referral: '7fda9071-4f0d-4fe6-b3ac-b1c484d5601a',
  manual: 'a7cb6b9e-b0b4-4c40-85bf-27a0172d4353'
}
module.exports = {
  id: {
    referral: referralId,
    settlement: settlementId
  },
  allSettlementStats,
  settlementStatsByCurrency,
  knownChains: Object.assign({}, knownChains),
  insertTransaction,
  insertUserDepositFromChain,
  insertFromSettlement,
  insertFromVoting,
  insertFromReferrals,
  insertFromAd,
  insertMany: {
    fromVoting: insertManyFromVoting
  }
}

function referralId (id, normalizedChannel) {
  return uuidv5(id + normalizedChannel, '3d3e7966-87c3-44ed-84c3-252458f99536')
}

function settlementId (id, normalizedChannel, type) {
  return uuidv5(id + normalizedChannel, SETTLEMENT_NAMESPACE[type])
}

async function insertTransaction (runtime, client, options = {}) {
  let {
    id,
    createdAt,
    description,
    transactionType,
    documentId,
    fromAccount,
    fromAccountType,
    toAccount,
    toAccountType,
    amount,
    settlementCurrency = null,
    settlementAmount = null,
    channel = null
  } = options

  if (!amount) {
    throw new Error('Missing amount field')
  }

  amount = new BigNumber(amount)
  if (amount.lessThanOrEqualTo(0)) {
    return [] // skip because we don't track tx's that don't have an accounting purpose
  }
  amount = amount.toString()

  const args = [id, createdAt, description, transactionType, documentId, fromAccount, fromAccountType, toAccount, toAccountType, amount, settlementCurrency, settlementAmount, channel]
  const query = `
INSERT INTO transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, settlement_currency, settlement_amount, channel )
VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 )
`
  await runtime.postgres.query(query, args, client)
}

async function insertUserDepositFromChain (runtime, client, chainDoc = {}) {
  let {
    id,
    amount,
    chain,
    cardId,
    createdAt,
    address
  } = chainDoc

  // using this so that we can pass in ticker / full name for now
  chain = knownChains[chain] || chain

  return insertTransaction(runtime, client, {
    id: uuidv5(`${chain}-${id}`, 'f7a8b983-2383-48f2-9e4f-717f6fe3225d'),
    createdAt: createdAt / 1000,
    description: `deposits from ${chain} chain`,
    transactionType: 'user_deposit',
    documentId: id,
    fromAccount: address,
    fromAccountType: chain,
    toAccount: cardId,
    toAccountType: 'uphold',
    amount: amount.toString()
  })
}

async function insertFromAd (runtime, client, {
  payment_id: paymentId,
  token_id: tokenId,
  amount
}) {
  const created = seconds()
  const { config } = runtime
  const id = uuidv5(`${paymentId}:${tokenId}`, '2ca02950-084f-475f-bac3-42a3c99dec95')
  const month = monthsFromSeconds(created)
  const options = {
    id,
    createdAt: created,
    description: `ad payments through ${month}`,
    transactionType: 'ad',
    documentId: tokenId,
    fromAccount: config.wallet.adsPayoutAddress.BAT,
    fromAccountType: 'uphold',
    toAccount: paymentId,
    toAccountType: 'payment_id',
    amount
  }
  return insertTransaction(runtime, client, options)
}

function monthsFromSeconds (created) {
  return new Date(created * 1000).toDateString().split(' ')[1]
}

function seconds () {
  return +(new Date()) / 1000
}

async function insertFromSettlement (runtime, client, settlement) {
  if (settlement.altcurrency !== 'BAT') {
    throw new Error('Only altcurrency === BAT transactions are supported')
  }
  const BATtoProbi = runtime.currency.alt2scale(settlement.altcurrency)
  if (settlement.probi && settlement.owner) {
    const probi = new BigNumber(settlement.probi.toString())
    const fees = new BigNumber(settlement.fees.toString())
    if (probi.greaterThan(new BigNumber(0))) {
      const normalizedChannel = normalizeChannel(settlement.publisher)
      const props = getPublisherProps(normalizedChannel)
      if (props.providerName && props.providerName === 'youtube' && props.providerSuffix === 'user') {
        throw new Error('Unexpected provider suffix: youtube#user')
      }
      const { executedAt } = settlement
      const created = executedAt ? new Date(executedAt) : createdTimestamp(settlement._id)
      const month = new Date(created).toDateString().split(' ')[1]

      if (settlement.type === 'contribution') {
        // channel -> owner for probi + fees, only applies to contributions
        const query1 = `
          insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
          VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
          `
        await runtime.postgres.query(query1, [
          // settlementId and channel pair should be unique per settlement type
          uuidv5(settlement.settlementId + normalizedChannel, 'eb296f6d-ab2a-489f-bc75-a34f1ff70acb'),
          (created / 1000) - 2,
          `contributions through ${month}`,
          'contribution',
          settlement._id.toString(),
          normalizedChannel,
          'channel',
          settlement.owner, // FIXME? owner including prefix or excluding?
          'owner',
          probi.plus(fees).dividedBy(BATtoProbi).toString(),
          normalizedChannel
        ], client)

        // owner -> brave for fees, only applies to contributions
        if (fees.greaterThan(new BigNumber(0))) {
          const query2 = `
          insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
          VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
          `
          await runtime.postgres.query(query2, [
            // settlementId and channel pair should be unique per settlement type
            uuidv5(settlement.settlementId + normalizedChannel, '1d295e60-e511-41f5-8ae0-46b6b5d33333'),
            (created / 1000) - 1,
            'settlement fees',
            'fees',
            settlement._id.toString(),
            settlement.owner,
            'owner',
            'fees-account',
            'internal',
            fees.dividedBy(BATtoProbi).toString(),
            normalizedChannel
          ], client)
        }
      } else if (settlement.type === 'manual') {
        // first insert the brave -> owner transaction
        await insertManual(runtime, client, settlement.settlementId, created, settlement.documentId, settlement.owner, settlement.probi)
      }

      // owner -> owner uphold for probi
      const query3 = `
        insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, settlement_currency, settlement_amount, channel )
        VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 )
        `
      await runtime.postgres.query(query3, [
        // settlementId and channel pair should be unique per settlement type
        settlementId(settlement.settlementId, normalizedChannel, settlement.type),
        (created / 1000),
        `payout for ${settlement.type}`,
        `${settlement.type}_settlement`,
        settlement.type === 'manual' ? settlement.documentId : settlement._id.toString(),
        settlement.owner,
        'owner',
        settlement.address,
        'uphold',
        probi.dividedBy(BATtoProbi).toString(),
        settlement.currency,
        settlement.amount.toString(),
        normalizedChannel
      ], client)
    } else {
      throw new Error('Settlement probi must be greater than 0')
    }
  } else {
    throw new Error('Missing probi or owner field')
  }
}

async function insertManual (runtime, client, settlementId, created, documentId, toAccount, probi) {
  const description = 'handshake agreement with business developement'
  const transactionType = 'manual'
  const fromAccount = runtime.config.wallet.settlementAddress.BAT
  const fromAccountType = 'uphold'
  const toAccountType = 'owner'

  const BATtoProbi = runtime.currency.alt2scale('BAT')
  const amountBAT = (new BigNumber(probi.toString())).dividedBy(BATtoProbi).toString()

  const insertTransactionQuery = `
    insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount )
    VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10 )
  `
  await runtime.postgres.query(insertTransactionQuery, [
    uuidv5(settlementId + toAccount, '734a27cd-0834-49a5-8d4c-77da38cdfb22'),
    created / 1000,
    description,
    transactionType,
    documentId,
    fromAccount,
    fromAccountType,
    toAccount,
    toAccountType,
    amountBAT
  ], client)
}

function insertFromVotingArguments (settlementAddress, voteDoc, surveyorCreatedAt) {
  if (voteDoc.amount) {
    const amount = new BigNumber(voteDoc.amount.toString())
    const fees = new BigNumber(voteDoc.fees.toString())

    if (amount.greaterThan(new BigNumber(0))) {
      const normalizedChannel = normalizeChannel(voteDoc.channel)
      const props = getPublisherProps(normalizedChannel)
      if (props.providerName && props.providerName === 'youtube' && props.providerSuffix === 'user') {
        // skip for now
        return
      }

      return [
        // surveyorId and channel pair should be unique
        uuidv5(voteDoc.surveyorId + normalizedChannel, 'be90c1a8-20a3-4f32-be29-ed3329ca8630'),
        surveyorCreatedAt,
        `votes from ${voteDoc.surveyorId}`,
        'contribution',
        voteDoc.surveyorId,
        settlementAddress,
        'uphold',
        normalizedChannel,
        'channel',
        amount.plus(fees).toString(),
        normalizedChannel
      ]
    }
  } else {
    throw new Error('Missing amount field')
  }
}

async function insertManyFromVoting (atOneTime, runtime, client, docs, surveyorCreatedAt) {
  if (!docs.length) {
    return
  }
  for (let i = 0; i < docs.length; i += atOneTime) {
    const mapped = docs.slice(i, i + atOneTime).map((doc) =>
      insertFromVotingArguments(
        runtime.config.wallet.settlementAddress.BAT,
        doc,
        surveyorCreatedAt
      )
    )
    const query = `
    insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
    VALUES`
    await runtime.postgres.insert(query, mapped, { client })
  }
}

async function insertFromVoting (runtime, client, voteDoc, surveyorCreatedAt) {
  if (voteDoc.amount) {
    const amount = new BigNumber(voteDoc.amount.toString())
    const fees = new BigNumber(voteDoc.fees.toString())

    if (amount.greaterThan(new BigNumber(0))) {
      const normalizedChannel = normalizeChannel(voteDoc.channel)
      const props = getPublisherProps(normalizedChannel)
      if (props.providerName && props.providerName === 'youtube' && props.providerSuffix === 'user') {
        // skip for now
        return
      }

      const query = `
      insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
      VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 )
      `
      await runtime.postgres.query(query, [
        // surveyorId and channel pair should be unique
        uuidv5(voteDoc.surveyorId + normalizedChannel, 'be90c1a8-20a3-4f32-be29-ed3329ca8630'),
        surveyorCreatedAt,
        `votes from ${voteDoc.surveyorId}`,
        'contribution',
        voteDoc.surveyorId,
        runtime.config.wallet.settlementAddress.BAT,
        'uphold',
        normalizedChannel,
        'channel',
        amount.plus(fees).toString(),
        normalizedChannel
      ], client)
    }
  } else {
    throw new Error('Missing amount field')
  }
}

async function insertFromReferrals (runtime, client, referrals) {
  if (referrals._id.altcurrency !== 'BAT') {
    throw new Error('Only altcurrency === BAT transactions are supported')
  }
  const BATtoProbi = runtime.currency.alt2scale(referrals._id.altcurrency)

  if (referrals.probi) {
    const probi = new BigNumber(referrals.probi.toString())
    const created = createdTimestamp(referrals.firstId)
    const month = new Date(created).toDateString().split(' ')[1]

    if (probi.greaterThan(new BigNumber(0))) {
      const normalizedChannel = normalizeChannel(referrals._id.publisher)
      const props = getPublisherProps(normalizedChannel)
      if (props.providerName && props.providerName === 'youtube' && props.providerSuffix === 'user') {
        throw new Error('Unexpected provider suffix: youtube#user')
      }

      const query = `
      insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
      values ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
      `
      await runtime.postgres.query(query, [
        // transactionId and channel pair should be unique
        referralId(referrals.transactionId, normalizedChannel),
        created / 1000,
        `referrals through ${month}`,
        'referral',
        referrals.transactionId,
        runtime.config.wallet.settlementAddress[referrals._id.altcurrency],
        'uphold',
        referrals._id.owner,
        'owner',
        probi.dividedBy(BATtoProbi).toString(),
        normalizedChannel
      ], client)
    }
  }
}

async function allSettlementStats (runtime, options) {
  const {
    type,
    start,
    until
  } = options
  const statsQuery = `
SELECT
    sum(amount) as amount
FROM transactions
WHERE
    transaction_type = $1
AND created_at >= to_timestamp($2)
AND created_at < to_timestamp($3);
`
  const args = [type, start / 1000, until / 1000]
  const { rows } = await runtime.postgres.query(statsQuery, args, true)
  return rows[0]
}

async function settlementStatsByCurrency (runtime, options) {
  const {
    type,
    settlementCurrency,
    start,
    until
  } = options
  const statsQuery = `
SELECT
    sum(amount) as amount
FROM transactions
WHERE
    transaction_type = $1
AND settlement_currency = $2
AND created_at >= to_timestamp($3)
AND created_at < to_timestamp($4);
`
  const args = [type, settlementCurrency, start / 1000, until / 1000]
  const { rows } = await runtime.postgres.query(statsQuery, args, true)
  return rows[0]
}
