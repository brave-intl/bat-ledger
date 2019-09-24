const { Netmask } = require('netmask')
const underscore = require('underscore')
const dotenv = require('dotenv')
dotenv.config()

module.exports = {
  ...parse(),
  parse
}

function parse () {
  const {
    PORT
  } = process.env
  return {
    PORT,
    ALLOWED_ADS_TOKENS: computeTokenList('ALLOWED_ADS_TOKENS'),
    ALLOWED_PUBLISHERS_TOKENS: computeTokenList('ALLOWED_PUBLISHERS_TOKENS'),
    TOKEN_LIST: computeTokenList('TOKEN_LIST'),
    GRAYLIST: computeIPList('IP_GREYLIST'),
    WHITELIST: computeIPList('IP_WHITELIST', {
      authorizedAddrs: (addrs) => addrs.length ? [ '127.0.0.1' ] : []
    })
  }
}

function computeTokenList (key) {
  const { [key]: LIST } = process.env
  return LIST ? LIST.split(',') : []
}

function computeIPList (key, options = {}) {
  const {
    authorizedAddrs: authAddrsMethod = () => ([])
  } = options
  const {
    [key]: IP_LIST
  } = process.env

  const addresses = IP_LIST ? IP_LIST.split(',') : []
  const authorizedAddrs = authAddrsMethod(addresses)
  const authorizedBlocks = []
  const LIST = {
    authorizedAddrs,
    authorizedBlocks,
    addresses,
    methods: {
      checkAuthed
    }
  }

  addresses.forEach((entry) => {
    if ((entry.indexOf('/') === -1) && (entry.split('.').length === 4)) {
      return authorizedAddrs.push(entry)
    }
    authorizedBlocks.push(new Netmask(entry))
  })

  return LIST

  function checkAuthed (ipaddr) {
    return !authorizedAddrs.includes(ipaddr) || underscore.find(authorizedBlocks, (block) => {
      return block.contains(ipaddr)
    })
  }
}
