const querystring = require('querystring')
const { URL } = require('url')

const tldjs = require('tldjs')
const underscore = require('underscore')

const providerRE = /^([A-Za-z0-9][A-Za-z0-9-]{0,62})#([A-Za-z0-9][A-Za-z0-9-]{0,62}):(([A-Za-z0-9-._~]|%[0-9A-F]{2})+)$/

const publisherURLs = {
  twitch: (props) => {
    if (props.providerSuffix === 'channel') return ('https://www.twitch.tv/' + props.providerValue)
  },

  youtube: (props) => {
    if (props.providerSuffix === 'channel') return ('https://www.youtube.com/channel/' + props.providerValue)
  }
}

module.exports = {
  isPublisher,
  getPublisherProps
}

function getPublisherProps (publisher) {
  const provider = providerRE.exec(publisher)
  let f, props, providerURL

  if (provider) {
    props = {
      publisher: provider[0],
      publisherType: 'provider',
      providerName: provider[1],
      providerSuffix: provider[2],
      providerValue: querystring.unescape(provider[3])
    }

    f = publisherURLs[props.providerName.toLowerCase()]
    providerURL = f && f(props)
    if (providerURL) props.URL = providerURL

    underscore.extend(props, {
      TLD: props.publisher.split(':')[0],
      SLD: props.publisher,
      RLD: props.providerValue,
      QLD: ''
    })

    return props
  }

  props = tldjs.parse(publisher)
  if ((!props) || (!props.isValid) || (!props.publicSuffix)) return false

  if (publisher.indexOf(':') === -1) publisher = 'https://' + publisher
  props = new URL(publisher)
  if ((!props) || (props.hash) || (props.search)) return

  props = underscore.mapObject(props, (value /* , key */) => { if (!underscore.isFunction(value)) return value })
  props.URL = publisher
  props.SLD = tldjs.getDomain(props.hostname)
  props.RLD = tldjs.getSubdomain(props.hostname)
  props.QLD = props.RLD ? underscore.last(props.RLD.split('.')) : ''

  return props
}

//  cf., https://github.com/brave-intl/bat-publisher#syntax

function isPublisher (publisher) {
  let props

  if (providerRE.test(publisher)) return true

  props = tldjs.parse(publisher)
  if ((!props) || (!props.isValid) || (!props.publicSuffix)) return false

  if (publisher.indexOf(':') === -1) publisher = 'https://' + publisher
  props = new URL(publisher)
  return ((props) && (!props.hash) && (!props.search))
}
