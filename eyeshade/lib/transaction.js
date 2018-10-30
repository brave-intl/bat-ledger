const BigNumber = require('bignumber.js')
const getPublisherProps = require('bat-publisher').getPublisherProps
const uuidv5 = require('uuid/v5')
const uuid = require('uuid')
const {
  createdTimestamp,
  normalizeChannel
} = require('bat-utils/lib/extras-utils')

const SETTLEMENT_NAMESPACE = {
  'contribution': '4208cdfc-26f3-44a2-9f9d-1f6657001706',
  'referral': '7fda9071-4f0d-4fe6-b3ac-b1c484d5601a'
}

exports.insertFromSettlement = async (runtime, client, settlement) => {
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

      const created = createdTimestamp(settlement._id)
      const month = new Date(created).toDateString().split(' ')[1]

      if (settlement.type === 'contribution') {
        // channel -> owner for probi + fees, only applies to contributions
        const query1 = `
          insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
          VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
          `
        await client.query(query1, [
          // settlementId and channel pair should be unique per settlement type
          uuidv5(settlement.settlementId + normalizedChannel, 'eb296f6d-ab2a-489f-bc75-a34f1ff70acb'),
          created / 1000,
          `contributions through ${month}`,
          'contribution',
          settlement._id.toString(),
          normalizedChannel,
          'channel',
          settlement.owner, // FIXME? owner including prefix or excluding?
          'owner',
          probi.plus(fees).dividedBy(BATtoProbi).toString(),
          normalizedChannel
        ])

        // owner -> brave for fees, only applies to contributions
        if (fees.greaterThan(new BigNumber(0))) {
          const query2 = `
          insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
          VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
          `
          await client.query(query2, [
            // settlementId and channel pair should be unique per settlement type
            uuidv5(settlement.settlementId + normalizedChannel, '1d295e60-e511-41f5-8ae0-46b6b5d33333'),
            (created / 1000) + 1,
            'settlement fees',
            'fees',
            settlement._id.toString(),
            settlement.owner,
            'owner',
            'fees-account',
            'internal',
            fees.dividedBy(BATtoProbi).toString(),
            normalizedChannel
          ])
        }
      }

      // owner -> owner uphold for probi
      const query3 = `
        insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, settlement_currency, settlement_amount, channel )
        VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 )
        `
      await client.query(query3, [
        // settlementId and channel pair should be unique per settlement type
        uuidv5(settlement.settlementId + normalizedChannel, SETTLEMENT_NAMESPACE[settlement.type]),
        (created / 1000) + 2,
        `payout for ${settlement.type}`,
        `${settlement.type}_settlement`,
        settlement._id.toString(),
        settlement.owner,
        'owner',
        settlement.address,
        'uphold',
        probi.dividedBy(BATtoProbi).toString(),
        settlement.currency,
        settlement.amount.toString(),
        normalizedChannel
      ])
    } else {
      throw new Error('Settlement probi must be greater than 0')
    }
  } else {
    throw new Error('Missing probi or owner field')
  }
}

exports.insertFromVoting = async (runtime, client, voteDoc, surveyorCreatedAt) => {
  if (voteDoc._id.altcurrency !== 'BAT') {
    throw new Error('Only altcurrency === BAT transactions are supported')
  }
  const BATtoProbi = runtime.currency.alt2scale(voteDoc._id.altcurrency)

  if (voteDoc.probi) {
    const probi = new BigNumber(voteDoc.probi.toString())
    const fees = new BigNumber(voteDoc.fees.toString())

    if (probi.greaterThan(new BigNumber(0))) {
      const normalizedChannel = normalizeChannel(voteDoc._id.publisher)
      const props = getPublisherProps(normalizedChannel)
      if (props.providerName && props.providerName === 'youtube' && props.providerSuffix === 'user') {
        // skip for now, we will reprocess later
        return
      }

      const query = `
      insert into transactions ( id, created_at, description, transaction_type, document_id, from_account, from_account_type, to_account, to_account_type, amount, channel )
      VALUES ( $1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11 )
      `
      await client.query(query, [
        // surveyorId and channel pair should be unique
        uuidv5(voteDoc.surveyorId + normalizedChannel, 'be90c1a8-20a3-4f32-be29-ed3329ca8630'),
        surveyorCreatedAt / 1000,
        `votes from ${voteDoc.surveyorId}`,
        'contribution',
        voteDoc.surveyorId,
        runtime.config.wallet.settlementAddress[voteDoc._id.altcurrency],
        'uphold',
        normalizedChannel,
        'channel',
        probi.plus(fees).dividedBy(BATtoProbi).toString(),
        normalizedChannel
      ])
    }
  } else {
    throw new Error('Missing probi field')
  }
}

exports.insertFromReferrals = async (runtime, client, referrals) => {
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
      await client.query(query, [
        // transactionId and channel pair should be unique
        uuid.v4(),
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
      ])
    }
  }
}

exports.updateBalances = async (runtime, client, concurrently) => {
  if (concurrently) {
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances')
  } else {
    await client.query('REFRESH MATERIALIZED VIEW account_balances')
  }
}
