const client = require('prom-client')
const SDebug = require('sdebug')
const _ = require('underscore')
const redis = require('redis')
const debug = new SDebug('prometheus')
const listenerPrefix = `listeners:prometheus:`
const listenerChannel = `${listenerPrefix}${process.env.SERVICE}`

function Prometheus (config, runtime) {
  if (!(this instanceof Prometheus)) {
    return new Prometheus(config, runtime)
  }

  const { prometheus } = config
  if (!prometheus) return
  this.config = prometheus
  this.register = new client.Registry()
  this.client = client
  this.runtime = runtime
  this.metrics = {}
  this.caches = {}
  this.shared = {}
  this.listenerId = `${listenerPrefix}${this.config.label}`

  const timeout = 10000
  this.timeout = timeout
  setInterval(() => this.maintenance(), timeout)
  process.on('exit', () => this.quit())
}

Prometheus.prototype.maintenance = function () {
  const { interval, client, timeout, register } = this
  this.interval = interval || client.collectDefaultMetrics({
    timeout,
    register
  })
  this.merge()
}

Prometheus.prototype.duration = function (start) {
  const diff = process.hrtime(start)
  return Math.round((diff[0] * 1e9 + diff[1]) / 1000000)
}

Prometheus.prototype.quit = function () {
  const { interval, caches } = this
  const { publisher, subscriber } = caches
  clearInterval(interval)
  if (publisher) {
    publisher.cache.quit()
  }
  if (subscriber) {
    const { cache } = subscriber
    cache.del(this.listenerId)
    cache.unsubscribe()
    cache.quit()
  }
}

Prometheus.prototype.allMetrics = function () {
  const { shared, register, client } = this
  const valueList = _.values(shared)
  const values = valueList.concat([register.getMetricsAsJSON()])
  return client.AggregatorRegistry.aggregate(values)
}

Prometheus.prototype.registerMetrics = function () {
  const { client, register } = this
  let name
  const log2Buckets = client.exponentialBuckets(2, 2, 15)

  name = 'http_request_duration_milliseconds'
  register.removeSingleMetric(name)
  const httpRequestDurationMilliseconds = new client.Summary({
    name,
    help: 'request duration in milliseconds',
    labelNames: ['method', 'path', 'cardinality', 'status']
  })
  register.registerMetric(httpRequestDurationMilliseconds)

  name = 'http_request_buckets_milliseconds'
  register.removeSingleMetric(name)
  const httpRequestBucketsMilliseconds = new client.Histogram({
    name,
    help: 'request duration buckets in milliseconds',
    labelNames: ['method', 'path', 'cardinality', 'status'],
    buckets: log2Buckets
  })
  register.registerMetric(httpRequestBucketsMilliseconds)

  const upholdApiRequestBucketsMilliseconds = new client.Histogram({
    name: 'uphold_request_buckets_milliseconds',
    help: 'uphold request duration buckets in milliseconds',
    labelNames: ['method', 'path', 'cardinality', 'status'],
    buckets: log2Buckets
  })
  register.registerMetric(upholdApiRequestBucketsMilliseconds)

  const anonizeVerifyRequestBucketsMilliseconds = new client.Histogram({
    name: 'anonizeVerify_request_buckets_milliseconds',
    help: 'request duration buckets in milliseconds',
    buckets: log2Buckets
  })
  register.registerMetric(anonizeVerifyRequestBucketsMilliseconds)

  const anonizeRegisterRequestBucketsMilliseconds = new client.Histogram({
    name: 'anonizeRegister_request_buckets_milliseconds',
    help: 'request duration buckets in milliseconds',
    buckets: log2Buckets
  })
  register.registerMetric(anonizeRegisterRequestBucketsMilliseconds)
  // should only happen once, so skip next time its called
  this.registerMetrics = () => {}
}

Prometheus.prototype.plugin = function () {
  const { register } = this
  const plugin = {
    register: (server, o, done) => {
      this.registerMetrics()

      server.route({
        method: 'GET',
        path: '/metrics',
        handler: (req, reply) => {
          const registry = this.allMetrics()
          const metrics = registry.metrics()
          reply(metrics).type('text/plain')
        }
      })

      server.route({
        method: 'GET',
        path: '/metrics-internal',
        handler: (req, reply) => reply(register.metrics()).type('text/plain')
      })

      server.ext('onRequest', (request, reply) => {
        request.prometheus = { start: process.hrtime() }
        reply.continue()
      })

      server.on('response', (response) => {
        const analysis = response._route._analysis
        const statusCode = response.response.statusCode
        let cardinality, method, params, path

        const duration = this.duration(response.prometheus.start)

        method = response.method.toLowerCase()
        params = _.clone(analysis.params)
        cardinality = params.length ? 'many' : 'one'
        path = analysis.fingerprint.split('/')
        for (let i = 0; i < path.length; i++) { if (path[i] === '?') path[i] = '{' + (params.shift() || '?') + '}' }
        path = path.join('/')

        this.getMetric('http_request_duration_milliseconds')
          .labels(method, path, cardinality, statusCode || 0)
          .observe(duration)

        this.getMetric('http_request_buckets_milliseconds')
          .labels(method, path, cardinality, statusCode || 0)
          .observe(duration)
      })

      this.maintenance()
      return done()
    }
  }

  plugin.register.attributes = {
    name: 'runtime-prometheus',
    version: '1.0.0'
  }

  return plugin
}

Prometheus.prototype.setCounter = async function (name, help, value) {
  const { metrics, client } = this
  if (!metrics[name]) metrics[name] = new client.Counter({ name, help })

  metrics[name].reset()
  metrics[name].inc(value)
}

Prometheus.prototype.incrCounter = async function (name, help, delta) {
  const { metrics, client } = this
  if (!metrics[name]) metrics[name] = new client.Counter({ name, help })

  metrics[name].inc(delta)
}

Prometheus.prototype.setGauge = async function (name, help, value) {
  const { metrics, client } = this
  if (!metrics[name]) {
    metrics[name] = new client.Gauge({ name, help })
  }

  metrics[name].set(value)
}

Prometheus.prototype.getMetric = function (name) {
  return this.client.register.getSingleMetric(name)
}

Prometheus.prototype.timedRequest = function (name, knownObs = {}) {
  const metric = this.getMetric(name)
  const start = process.hrtime()
  return (moreObs = {}) => {
    const duration = this.duration(start)
    const hash = Object.assign({}, knownObs, moreObs)
    const labels = _.map(metric.labelNames, (key) => hash[key])
    metric.labels.apply(metric, labels).observe(duration)
  }
}

Prometheus.prototype.subscriber = function () {
  const { caches, config } = this
  let { subscriber } = caches
  if (subscriber) {
    return subscriber
  }
  subscriber = redis.createClient(config.redis)
  caches.subscriber = subscriber

  subscriber.on('connect', () => {
    debug('listeners', { count: null, id: this.listenerId })
    this.stayinAlive()
    const list = subscriber.keys(`${listenerPrefix}*`)
    debug('listeners', { list })
    subscriber.subscribe(listenerChannel)
  }).on('subscribe', async (channel, count) => {
    debug('subscribe', { channel, count })
    this.publish(_.values(this.shared || {}))
  }).on('message', (channel, message) => {
    let packet
    try {
      packet = JSON.parse(message)
    } catch (ex) {
      return debug('message', { channel, error: ex.toString() })
    }
    const { label, data } = packet
    if (label === config.label) {
      return
    }
    this.shared[label] = data
  })

  return subscriber
}

Prometheus.prototype.stayinAlive = function () {
  const cache = this.publisher()
  cache.set([this.listenerId, 'true', 'EX', 60])
}

Prometheus.prototype.publisher = function () {
  const { caches, config } = this
  let { publisher } = caches
  if (publisher) {
    return publisher
  }
  publisher = redis.createClient(config.redis)
  caches.publisher = publisher
  return publisher
}

Prometheus.prototype.publish = function (data) {
  const publisher = this.publisher()
  const { label } = this.config
  const json = JSON.stringify({
    data,
    label
  })
  publisher.publish([listenerChannel, json])
}

Prometheus.prototype.merge = function () {
  const { register, config } = this
  const { label } = config

  const entries = register.getMetricsAsJSON()
  this.publish(entries)

  if (label.includes('.worker.')) {
    return
  }
  this.subscriber()
  this.stayinAlive()
}

module.exports = Prometheus
