const { Pool } = require('pg')
const { v4 } = require('uuid')
const { getPublisherProps } = require('bat-publisher')
const { toBat, justDate } = require('bat-utils/lib/extras-utils')
const BigNumber = require('bignumber.js')

module.exports = Postgres
const UPHOLD = 'uphold'
const CHANNEL = 'channel'
const OWNER = 'owner'

Postgres.insertTransaction = insertTransaction
Postgres.pool = pool
Postgres.createDescription = createDescription
Postgres.createTypeDescription = createTypeDescription
Postgres.settlementAddress = settlementAddress
Postgres.feeAddress = feeAddress
Postgres.createVoteDescription = createVoteDescription
Postgres.createReferralDescription = createReferralDescription
Postgres.types = {
  UPHOLD,
  CHANNEL,
  OWNER
}

Postgres.prototype = {
  connected,
  insertTransaction,
  insertTransactions,
  transactionsFrom,
  finished
}

const conversions = {
  settlement: convertSettlement,
  referral: convertReferral,
  vote: convertVote
}

function Postgres (config, runtime) {
  if (!(this instanceof Postgres)) {
    return new Postgres(config, runtime)
  }
  const {
    settings
  } = config.postgres

  const pg = pool(settings)
  this.db = pg
  this.connectPromise = pg.connect()
  this.conversions = Object.assign({}, conversions)
  pg.on('error', (err) => {
    console.error(err, this.db)
  })
}

function finished () {
  return this.db.end()
}

function connected () {
  return this.connectPromise
}

function transactionsFrom (key, inputs) {
  if (!key || !inputs) {
    return []
  }
  const conversion = this.conversions[key]
  if (!conversion) {
    return []
  }
  return conversion(inputs)
}

function settlementAddress () {
  return process.env.BAT_SETTLEMENT_ADDRESS
}

function feeAddress () {
  return process.env.BAT_FEE_ADDRESS || 'placeholder-fee-address'
}

function createDescription (type, createdAt) {
  return `${type}: ${justDate(createdAt)}`
}

function createReferralDescription (transactionId, publisher) {
  return `${transactionId}-${publisher}`
}

function createVoteDescription (surveyorId) {
  return `${surveyorId} votes`
}

function createTypeDescription (transType, type, createdAt) {
  return `${transType} for ${createDescription(type, createdAt)}`
}

async function insertTransactions (transactions) {
  await this.connected()
  const mapper = insertTX.bind(null, this.db)
  await Promise.all(transactions.map(mapper))
}

async function insertTransaction (transaction) {
  await this.connected()
  await insertTX(this.db, transaction)
}

function convertSettlement (settlement) {
  const {
    probi,
    fees,
    settlementId,
    hash,
    currency = 'BAT',
    address,
    type,
    publisher,
    owner,
    createdAt
  } = settlement
  const memo = []
  if (!probi || !fees) {
    return memo
  }
  const bigProbi = new BigNumber(probi)
  const bigFees = new BigNumber(fees)
  const ownerProps = getPublisherProps(owner) || {
    providerValue: v4().toLowerCase()
  }
  const isContribution = type === 'contribution'
  const date = justDate(createdAt)
  // const description = `${type}: ${date}`
  if (isContribution) {
    memo.push({
      createdAt: createdAt,
      description: createDescription(type, date),
      transactionType: type,
      documentId: hash,
      amount: bigProbi.plus(bigFees).toString(),
      // from channel
      fromAccountType: 'channel',
      fromAccount: publisher,
      // to owner
      toAccountType: 'owner',
      toAccount: ownerProps.providerValue
    })
    if (bigFees.toNumber()) {
      let transType = 'fees'
      memo.push({
        createdAt: createdAt,
        description: createTypeDescription(transType, type, date),
        transactionType: transType,
        documentId: hash,
        amount: bigFees.toString(),
        // from brave
        fromAccountType: 'uphold',
        fromAccount: settlementAddress(),
        // from brave
        toAccountType: 'uphold',
        toAccount: feeAddress()
      })
    }
  }
  const batSettlementAmount = toBat(probi).valueOf()
  const transType = 'settlement'
  memo.push({
    createdAt: createdAt,
    description: createTypeDescription(transType, type, createdAt),
    transactionType: transType,
    documentId: settlementId,
    amount: bigProbi.toString(),
    settlementCurrency: currency,
    settlementAmount: batSettlementAmount,
    // from owner
    fromAccountType: 'uphold',
    fromAccount: settlementAddress(),
    // to uphold
    toAccountType: 'uphold',
    toAccount: address
  })
  return memo
}

// toTransaction
function insertTX (client, insertion) {
  const {
    bat,
    createdAt,
    description,
    transactionType,
    documentId,
    fromAccountType,
    fromAccount,
    toAccountType,
    toAccount,
    amount,
    settlementCurrency,
    settlementAmount
  } = insertion
  const insert = `
  INSERT INTO transactions ( id, description, transaction_type, document_id, from_account_type, from_account, to_account_type, to_account, amount, settlement_currency, settlement_amount, created_at )
  VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12) )
  `
  let created = (new Date(createdAt)).getTime() / 1000
  let batAmount = bat || toBat(amount).valueOf()
  if (!batAmount) {
    throw new Error('transaction must contain bat')
  }
  const columns = [
    v4().toLowerCase(),
    description,
    transactionType,
    documentId,
    fromAccountType,
    fromAccount,
    toAccountType,
    toAccount,
    batAmount,
    settlementCurrency || null,
    settlementAmount || null,
    created
  ]
  return client.query(insert, columns)
}

function pool (options) {
  const {
    POSTGRES_HOST,
    POSTGRES_PASSWORD,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_DB
  } = process.env
  const defaults = {
    host: POSTGRES_HOST,
    user: POSTGRES_USER || 'eyeshade',
    database: POSTGRES_DB || 'eyeshade',
    password: POSTGRES_PASSWORD || 'password',
    port: POSTGRES_PORT
  }
  const opts = Object.assign(defaults, options)
  return new Pool(opts)
}

function convertVote (vote) {
  const {
    probi,
    createdAt,
    surveyorId,
    publisher
  } = vote
  let {
    counts = 1
  } = vote
  const amount = (new BigNumber(probi)).times(counts).toString()
  return [{
    createdAt,
    description: createVoteDescription(surveyorId),
    transactionType: 'contribution',
    documentId: createdAt,
    amount,
    // from brave
    fromAccountType: 'uphold',
    fromAccount: settlementAddress(),
    // to channel
    toAccountType: 'channel',
    toAccount: publisher
  }]
}

function convertReferral (referral) {
  const {
    owner,
    probi,
    publisher,
    transactionId,
    createdAt
  } = referral
  const ownerProps = getPublisherProps(owner)
  return [{
    createdAt: createdAt,
    transactionType: 'referral',
    documentId: createReferralDescription(transactionId, publisher),
    amount: probi.toString(),
    // from owner
    fromAccountType: 'uphold',
    fromAccount: settlementAddress(),
    // to uphold
    toAccountType: 'owner',
    toAccount: ownerProps.providerValue
  }]
}
