const SlackJS = require('node-slack')
const underscore = require('underscore')

const Slack = function (config, runtime) {
  if (!(this instanceof Slack)) return new Slack(config, runtime)

  if (!config.slack) throw new Error('config.slack undefined')

  if (!config.slack.webhook) throw new Error('config.slack.webhook undefined')

  this.slackjs = new SlackJS(runtime.config.slack.webhook)

  const chainNotify = runtime.notify
  runtime.notify = (debug, payload) => {
    if (chainNotify) {
      chainNotify(debug, payload)
    }
    const params = runtime.config.slack

    if (payload.text) debug('notify', { message: payload.text })

    underscore.defaults(payload, {
      channel: params.channel,
      username: params.username || process.npminfo.name,
      icon_url: params.icon_url,
      text: 'ping.'
    })
    this.slackjs.send(payload, (res, err, body) => {
      if (err) debug('notify', err)
    })
  }
}

module.exports = Slack
