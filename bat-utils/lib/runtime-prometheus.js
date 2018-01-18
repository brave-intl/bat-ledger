const client = require('prom-client')

const Prometheus = function (config, runtime) {
  if (!(this instanceof Prometheus)) return new Prometheus(config, runtime)

  this.metrics = {}
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
