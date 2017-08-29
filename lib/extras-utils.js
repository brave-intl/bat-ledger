var exports = {}

// courtesy of https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
exports.timeout = (msec) => { return new Promise((resolve) => { setTimeout(resolve, msec) }) }

module.exports = exports
