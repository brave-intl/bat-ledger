const crypto = require('crypto')
const dns = require('dns')

const boom = require('boom')
const underscore = require('underscore')

const batPublisher = require('bat-publisher')
const getPublisherProps = batPublisher.getPublisherProps
const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const prefix1 = 'brave-ledger-verification'
const prefix2 = prefix1 + '='

const hints = {
  standard: '/.well-known/brave-payments-verification.txt',
  root: '/'
}
const hintsK = underscore.keys(hints)

const dnsTxtResolver = async (domain) => {
  return new Promise((resolve, reject) => {
    dns.resolveTxt(domain, (err, rrset) => {
      if (err) return reject(err)

      resolve(rrset)
    })
  })
}

const webResolver = async (debug, runtime, publisher, path) => {
  debug('webResolver', { publisher: publisher, path: path })
  try {
    debug('webResolver', 'https://' + publisher + path)
    return await braveHapi.wreck.get('https://' + publisher + path,
                                     { redirects: 3, rejectUnauthorized: true, timeout: (5 * 1000) })
  } catch (ex) {
    try {
      debug('webResolver', 'https://www.' + publisher + path)
      return await braveHapi.wreck.get('https://www.' + publisher + path,
                                       { redirects: 3, rejectUnauthorized: true, timeout: (5 * 1000) })
    } catch (ex2) {
    }

    if (((!ex.isBoom) || (!ex.output) || (ex.output.statusCode !== 504)) && (ex.code !== 'ECONNREFUSED')) {
      debug('webResolver', publisher + ': ' + ex.toString())
    }
    throw ex
  }
}

const verified = async (request, reply, runtime, entry, verified, backgroundP, reason) => {
  const indices = underscore.pick(entry, [ 'verificationId', 'publisher' ])
  const debug = braveHapi.debug(module, request)
  const owners = runtime.database.get('owners', debug)
  const publishers = runtime.database.get('publishers', debug)
  const tokens = runtime.database.get('tokens', debug)
  let info, message, method, payload, props, result, state, visible, visibleP

  const publish = async (debug, runtime, method, owner, publisher, endpoint, payload) => {
    try {
      return runtime.common.publish(debug, runtime, 'patch', entry.owner, entry.publisher, '/verifications', payload)
    } catch (ex) {
      debug('publish', { method: method, owner: owner, publisher: publisher, endpoint: endpoint, reason: ex.toString() })
    }
  }

  message = underscore.extend(underscore.clone(indices), { verified: verified, reason: reason })
  debug('verified', message)
  if (/* (!backgroundP) || */ (verified)) {
    runtime.notify(debug, {
      channel: '#publishers-bot',
      text: (verified ? '' : 'not ') + 'verified: ' + JSON.stringify(message)
    })
  }

  entry.verified = verified
  if (reason.indexOf('Error: ') === 0) reason = reason.substr(7)
  if (reason.indexOf('Client request error: ') === 0) reason = reason.substr(22)
  if (reason.indexOf('Hostname/IP doesn\'t match certificate\'s altnames: ') === 0) reason = reason.substr(0, 48)
  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: { verified: entry.verified, reason: reason.substr(0, 64) }
  }
  await tokens.update(indices, state, { upsert: true })
  if (!verified) return

  reason = reason || (verified ? 'ok' : 'unknown')
  payload = underscore.extend(underscore.pick(entry, [ 'verificationId', 'token', 'verified' ]), { status: reason })
  await publish(debug, runtime, 'patch', entry.owner, entry.publisher, '/verifications', payload)

  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: underscore.pick(entry, [ 'owner', 'verified', 'visible', 'info' ])
  }
  await publishers.update({ publisher: entry.publisher }, state, { upsert: true })

  await tokens.remove({ publisher: entry.publisher, verified: false }, { justOne: false })

  if (entry.owner) {
    props = getPublisherProps(entry.owner)

    state = {
      $currentDate: { timestamp: { $type: 'timestamp' } },
      $set: underscore.pick(props || {}, [ 'providerName', 'providerSuffix', 'providerValue' ])
    }
    await owners.update({ owner: entry.owner }, state, { upsert: true })
  }

  await runtime.queue.send(debug, 'publisher-report', underscore.pick(entry, [ 'owner', 'publisher', 'verified', 'visible' ]))
  reply({ status: 'success', verificationId: entry.verificationId })

  if (entry.info) return

  result = await publish(debug, runtime, 'get', entry.owner, entry.publisher)
  if (result.id !== entry.verificationId) return

  visible = result.show_verification_status
  visibleP = (typeof visible !== 'undefined')
  method = result.verification_method
  info = underscore.pick(result, [ 'name', 'email' ])
  if (result.phone_normalized) info.phone = result.phone_normalized
  if (result.preferredCurrency) info.preferredCurrency = result.preferredCurrency

  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: { info: info }
  }
  if (visibleP) state.$set.visible = visible
  if (method) state.$set.method = method
  await tokens.update(indices, state, { upsert: true })

  await publishers.update(indices, state, { upsert: true })
}

module.exports = {}

module.exports.getToken = async (request, reply, runtime, owner, publisher, backgroundP) => {
  const debug = braveHapi.debug(module, request)
  const tokens = runtime.database.get('tokens', debug)
  let data, entries, hint, i, info, j, matchP, pattern, reason, rr, rrset

  entries = await tokens.find({ publisher: publisher })
  if (entries.length === 0) return reply(boom.notFound('no such publisher: ' + publisher))

  for (let entry of entries) {
    if (entry.verified) {
      await runtime.queue.send(debug, 'publisher-report',
                               underscore.pick(entry, [ 'owner', 'publisher', 'verified', 'visible' ]))
      return reply({ status: 'success', verificationId: entry.verificationId })
    }
  }

  try { rrset = await dnsTxtResolver(publisher) } catch (ex) {
    reason = ex.toString()
    if (reason.indexOf('ENODATA') === -1) {
      debug('dnsTxtResolver', underscore.extend({ publisher: publisher, reason: reason }))
    }
    rrset = []
  }
  for (i = 0; i < rrset.length; i++) { rrset[i] = rrset[i].join('') }

  const loser = async (entry, reason) => {
    debug('verify', underscore.extend(info, { reason: reason }))
    await verified(request, reply, runtime, entry, false, backgroundP, reason)
  }

  info = { publisher: publisher }
  data = {}
  for (let entry of entries) {
    info.verificationId = entry.verificationId

    for (j = 0; j < rrset.length; j++) {
      rr = rrset[j]
      if (rr.indexOf(prefix2) !== 0) continue

      matchP = true
      if (rr.substring(prefix2.length) !== entry.token) {
        await loser(entry, 'TXT RR suffix mismatch ' + prefix2 + entry.token)
        continue
      }

      return verified(request, reply, runtime, entry, true, backgroundP, 'TXT RR matches')
    }
    if (!matchP) {
      if (typeof matchP === 'undefined') await loser(entry, 'no TXT RRs starting with ' + prefix2)
      matchP = false
    }

    for (j = 0; j < hintsK.length; j++) {
      hint = hintsK[j]
      if (typeof data[hint] === 'undefined') {
        try { data[hint] = (await webResolver(debug, runtime, publisher, hints[hint])).toString() } catch (ex) {
          data[hint] = ''
          await loser(entry, ex.toString())
          continue
        }
        debug('verify', 'fetched data for ' + hint)
      }

      if (data[hint].indexOf(entry.token) !== -1) {
        switch (hint) {
          case root:
            pattern = '<meta[^>]*?name=["\']+' + prefix1 + '["\']+content=["\']+' + entry.token + '["\']+.*?>|' +
                    '<meta[^>]*?content=["\']+' + entry.token + '["\']+name=["\']+' + prefix1 + '["\']+.*?>'
            if (!data[hint].match(pattern)) continue
            break

          default:
            break
        }
        return verified(request, reply, runtime, entry, true, backgroundP, hint + ' web file matches')
      }
      debug('verify', 'no match for ' + hint)

      if (i === 0) break
    }
  }

  reply({ status: 'failure' })
}

module.exports.putToken = async (request, reply, runtime, owner, publisher, verificationId, visible) => {
  const debug = braveHapi.debug(module, request)
  const tokens = runtime.database.get('tokens', debug)
  let entry, state, token

  entry = await tokens.findOne({ verificationId: verificationId, publisher: publisher })
  if (entry) return reply({ token: entry.token })

  token = crypto.randomBytes(32).toString('hex')
  state = {
    $currentDate: { timestamp: { $type: 'timestamp' } },
    $set: { token: token, visible: visible }
  }
  if (owner) state.$set.owner = owner
  await tokens.update({ verificationId: verificationId, publisher: publisher }, state, { upsert: true })

  reply({ token: token })
}
