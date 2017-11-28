var exports = {}

// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
exports.timeout = (msec) => { return new Promise((resolve) => { setTimeout(resolve, msec) }) }

exports.extractJws = (jws) => {
  const payload = jws.split('.')[1]
  const buf = Buffer.from(payload, 'base64')
  return JSON.parse(buf.toString('utf8'))
}

module.exports = exports
