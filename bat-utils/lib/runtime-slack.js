const Raven = require('raven')
const SlackJS = require('node-slack')
const tldjs = require('tldjs')
const underscore = require('underscore')
const validateIP = require('validate-ip-node')

const npminfo = require('../npminfo')

module.exports = Slack

function Slack (config, runtime) {
  if (!(this instanceof Slack)) return new Slack(config, runtime)

  if (!config.slack) throw new Error('config.slack undefined')

  if (!config.slack.webhook) throw new Error('config.slack.webhook undefined')

  this.slackjs = new SlackJS(runtime.config.slack.webhook)

  let username = npminfo.name
  if (!validateIP(runtime.config.server.hostname)) username += '@' + tldjs.getSubdomain(runtime.config.server.hostname)

  runtime.notify = (debug, payload) => {
    const params = runtime.config.slack

    if (payload.text) debug('notify', { message: payload.text })

    underscore.defaults(payload, {
      channel: params.channel,
      username: params.username || username,
      icon_url: params.icon_url,
      text: 'ping.'
    })

    this.slackjs.send(payload, (res, err, body) => {
      if (err && err !== 'ok') {
        debug('notify', err)
        Raven.captureException(err)
      }
    })
  }
}
