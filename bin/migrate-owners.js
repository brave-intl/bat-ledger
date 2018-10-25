#!/usr/bin/env node
const main = require('./migrate-owners-runner')
module.exports = main({
  mongo: `${process.env.MONGODB_URI}/eyeshade`,
  postgres: process.env.DATABASE_URL
}).then(result => {}).catch(e => {
  console.error(e)
})
