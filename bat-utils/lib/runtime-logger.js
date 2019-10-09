module.exports = Logger

Logger.prototype = {
  log: function (key, id) {
    return this.client.pfaddAsync(key, id)
  },
  read: function (key, fn) {
    return this.client.pfcountAsync(key)
  },
  dailyKey: function (bulk) {
    const daily = (new Date()).toISOString().split('T')[0]
    return ['rewards'].concat(bulk, daily).join(':')
  },
  clear: function (key) {
    return this.client.delAsync(key)
  }
}

function Logger (config, runtime) {
  if (!(this instanceof Logger)) {
    return new Logger(config, runtime)
  }
  this.runtime = runtime
  this.config = config.logger
  const { cache, queue } = runtime
  this.client = (cache && cache.cache) || queue.config.client
  return this
}
