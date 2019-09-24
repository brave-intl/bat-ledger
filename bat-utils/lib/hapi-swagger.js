const swagger = require('hapi-swagger')
const npminfo = require('../npminfo')

module.exports = () => ({
  plugin: swagger,
  options: {
    auth: {
      strategy: 'whitelist',
      mode: 'required'
    },
    info: {
      title: npminfo.name,
      version: npminfo.version,
      description: npminfo.description
    }
  }
})
