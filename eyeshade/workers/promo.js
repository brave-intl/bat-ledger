const uuidv4 = require('uuid/v4')

const EYESHADE_BATCH_LIMIT = 500
const UPDATE_QUERY = `
UPDATE download
SET
  eyeshade_confirmed = 't',
  eyeshade_confirmed_ts = CURRENT_TIMESTAMP,
  eyeshade_confirmed_txid = $1
WHERE
  download_id = $2`

const SELECTION_QUERY = `
SELECT
  DD.download_id,
  PB.channel,
  DD.finalized_ts,
  DD.platform,
  PB.channel_type,
  RC.owner_id,
  DD.finalization_geo_group,
  DD.download_ts,
  DD.referral_code
FROM
  download       DD JOIN
  referral_codes RC ON RC.referral_code = DD.referral_code LEFT JOIN
  publishers     PB ON RC.channel_id = PB.channel
WHERE
      ( PB.promo IS NULL or PB.promo = 'free-bats-2018q1' ) AND
      RC.type = $1 AND
      DD.finalized AND
  NOT DD.eyeshade_confirmed AND
      DD.eyeshade_confirmed_txid IS NULL AND
  NOT RC.owner_id IS NULL
ORDER BY DD.finalized_ts
LIMIT ${EYESHADE_BATCH_LIMIT}
`

const SERVICES = {
  twitter: true,
  twitch: true,
  youtube: true,
  github: true,
  reddit: true,
  vimeo: true
}

const maybeAppendChannelType = (channel, channelType) => {
  if (SERVICES[channelType] && !channel.startsWith(channelType + '#channel:')) {
    return channelType + '#channel:' + channel
  }
  return channel
}

// generate array of finalized downloads to send to eyeshade
const payoutPayload = async (db, type) => {
  const txid = uuidv4()

  const transactions = (await db.query(SELECTION_QUERY, [type])).rows.map((row) => {
    // FIXME temporary hack until https://github.com/brave-intl/vault-promo-services/pull/23/files
    // is merged / applied
    const channel = maybeAppendChannelType(row.channel, row.channel_type)

    return {
      downloadId: row.download_id,
      channelId: channel,
      platform: row.platform.replace('-bc', ''),
      finalized: row.finalized_ts,
      ownerId: 'publishers#uuid:' + row.owner_id,
      referralCode: row.referral_code,
      downloadTimestamp: row.download_ts,
      groupId: row.finalization_geo_group
    }
  })
  return [txid, transactions]
}

module.exports = {
  UPDATE_QUERY,
  payoutPayload
}
