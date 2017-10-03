const bluebird = require('bluebird')
const redis = require('redis')

bluebird.promisifyAll(redis.RedisClient.prototype)
bluebird.promisifyAll(redis.Multi.prototype)

const Cache = function (config, runtime) {
  if (!(this instanceof Cache)) return new Cache(config, runtime)

  if (!config.cache) return
  if (!config.cache.redis) return

  // TODO reconnect mechanism?
  this.cache = redis.createClient(config.cache.redis)
}

Cache.prototype.get = async function (key, prefix) {
  if (prefix) {
    key = `${prefix}:${key}`
  }
  return this.cache.getAsync(key)
}

Cache.prototype.set = async function (key, value, options, prefix) {
  if (prefix) {
    key = `${prefix}:${key}`
  }
  let args = [key, value]
  for (let key in options) {
    args = args.concat([key, options[key]])
  }
  return this.cache.setAsync(args)
}

Cache.prototype.del = async function (key, prefix) {
  if (prefix) {
    key = `${prefix}:${key}`
  }
  return this.cache.delAsync(key)
}

module.exports = Cache
