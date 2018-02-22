// TODO: add GC statistics

const SDebug = require('sdebug')
const client = require('prom-client')
const debug = new SDebug('prometheus')
const epimetheus = require('epimetheus')
const exposition = require('exposition')
const redis = require('redis')
const underscore = require('underscore')

const Prometheus = function (config, runtime) {
  if (!(this instanceof Prometheus)) return new Prometheus(config, runtime)

  this.metrics = {}

  if (!config.prometheus) return

  this.label = config.prometheus.label
  this.runtime = runtime
  this.local = {}
  this.global = {}

  if (config.prometheus.redis) this.publisher = redis.createClient(config.prometheus.redis)
  this.msgno = 0

  setInterval(this.maintenance.bind(this), 10 * 1000)
}

Prometheus.prototype.plugin = function () {
  let self = this

  let plugin = {
    register: (server, o, done) => {
      server.route({
        method: 'GET',
        path: '/metrics',
        handler: (req, reply) => {
          reply(exposition.stringify(underscore.values(self.global))).type('text/plain')
        }
      })

      epimetheus.instrument(server, { url: '/metrics-internal' })

      return done()
    }
  }

  plugin.register.attributes = {
    name: 'runtime-prometheus',
    version: '1.0.0'
  }

  return plugin
}

Prometheus.prototype.maintenance = function () {
  let self = this

  const entries = exposition.parse(client.register.metrics())
  let updates

  const merge = (source, destination) => {
    source.forEach((update) => {
      const name = update.name
      let entry

      if (!(update.metrics && update.metrics.length)) return

      entry = destination[name]
      if (!entry) {
        destination[name] = update
        return
      }

      update.metrics.forEach((metric) => {
        const offset = underscore.findIndex(entry.metrics, (value) => {
          return underscore.isEqual(metric.labels, value.labels)
        })
        if (offset < 0) entry.metrics.push(metric)
        else entry.metrics.splice(offset, 1, metric)
      })
    })
  }

  updates = []
  entries.forEach((entry) => {
    const metrics = []
    const name = entry.name

    // no metrics(?) or no change
    if ((!entry.metrics) || (underscore.isEqual(self.local[name] || {}, entry))) return

    self.local[name] = entry
    entry = underscore.clone(entry)
    entry.metrics.forEach((metric) => {
      metric.labels = underscore.clone(metric.labels) || {}
      underscore.extend(metric.labels, { dyno: self.label })
      metrics.push(metric)
    })
    entry.metrics = metrics

    updates.push(entry)
  })
  if (!updates.length) return

  merge(updates, self.global)

  if (!self.publisher) {
    self.publisher = (self.runtime.cache && self.runtime.cache.cache) || self.runtime.queue.config.client
    if (!self.publisher) return
  }

  self.publisher.publish('prometheus', JSON.stringify({ label: self.label, msgno: self.msgno++, updates: updates }))
  if (self.label.indexOf('.worker.') !== -1) return

  if (self.subscriber) return

  self.subscriber = self.publisher.duplicate().on('subscribe', (channel, count) => {
    debug('subscribe', { channel: channel, count: count })
  }).on('message', (channel, message) => {
    let packet

    try {
      packet = JSON.parse(message)
    } catch (ex) {
      return debug('message', { error: ex.toString() })
    }

    if (packet.label === self.label) return

    if (packet.msgno === 0) {
      self.publisher.publish('prometheus', JSON.stringify({ label: self.label, msgno: self.msgno++, updates: self.global }))
    }

    merge(packet.updates, self.global)
  })

  self.subscriber.subscribe('prometheus')
}

Prometheus.prototype.setCounter = async function (name, help, value) {
  if (!this.metrics[name]) this.metrics[name] = new client.Counter({ name: name, help: help })

  this.metrics[name].reset()
  this.metrics[name].inc(value)
}

Prometheus.prototype.incrCounter = async function (name, help, delta) {
  if (!this.metrics[name]) this.metrics[name] = new client.Counter({ name: name, help: help })

  this.metrics[name].inc(delta)
}

Prometheus.prototype.setGauge = async function (name, help, value) {
  if (!this.metrics[name]) this.metrics[name] = new client.Gauge({ name: name, help: help })

  this.metrics[name].set(value)
}

// NB: not doing histograms (yet!)

module.exports = Prometheus
