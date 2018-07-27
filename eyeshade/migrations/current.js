const { lstatSync, readdirSync } = require('fs')
const { join } = require('path')

const dirs = readdirSync(__dirname).filter((name) => lstatSync(join(__dirname, name)).isDirectory())
const migrations = dirs.sort().reverse()
module.exports = migrations[0] ? migrations[0].split('_')[0] : migrations
