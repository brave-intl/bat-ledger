var exports = {}

// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
exports.timeout = (msec) => { return new Promise((resolve) => { setTimeout(resolve, msec) }) }

exports.extractJws = (jws) => {
  const payload = jws.split('.')[1]
  const buf = Buffer.from(payload, 'base64')
  return JSON.parse(buf.toString('utf8'))
}

// courtesy of https://stackoverflow.com/questions/31649362/json-stringify-and-unicode-characters#31652607
exports.utf8ify = (data) => {
  if (typeof data !== 'string') data = JSON.stringify(data, null, 2)

  return data.replace(/[\u007F-\uFFFF]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).substr(-4)
  })
}

module.exports = exports
