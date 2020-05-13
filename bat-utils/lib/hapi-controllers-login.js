const os = require('os')
const boom = require('boom')
const Octokit = require('@octokit/rest')
const Joi = require('@hapi/joi')
const underscore = require('underscore')

const braveHapi = require('./extras-hapi')
const whitelist = require('./hapi-auth-whitelist')
const npminfo = require('../npminfo')

const v1 = {}

/*
   GET /v1/login
 */

v1.login = {
  handler: (runtime) => {
    return async (request, h) => {
      if (!request.auth.isAuthenticated) throw boom.forbidden()

      const debug = braveHapi.debug(module, request)
      const credentials = request.auth.credentials
      const { organization } = runtime.login.github

      try {
        const octokit = new Octokit({
          debug: false,
          auth: `token ${credentials.token}`
        })
        const { data: teams } = await octokit.teams.listForAuthenticatedUser({
          org: organization
        })

        credentials.scope = []
        teams.forEach(team => {
          if (team.organization.login === organization) credentials.scope.push(team.name)
        })
        if (credentials.scope.length === 0) {
          throw boom.forbidden()
        }
      } catch (e) {
        runtime.notify(debug, {
          channel: '#devops-bot',
          text: 'login failed ' + credentials.provider + ' ' + credentials.profile.email
        })
        throw e
      }

      runtime.notify(debug, {
        channel: '#devops-bot',
        text: 'login ' + credentials.provider + ' ' +
          JSON.stringify(underscore.pick(credentials.profile, ['username', 'displayName', 'email', 'id'])) +
          ': ' + JSON.stringify(credentials.scope) + ' at ' + os.hostname() + ' ' + npminfo.name + '@' +
          npminfo.version + (process.env.DYNO ? ' at ' + process.env.DYNO : '') + ' from ' + whitelist.ipaddr(request)
      })

      request.cookieAuth.set(credentials)
      return h.redirect(runtime.login.github.world)
    }
  },

  auth: 'github',

  description: 'Logs the user into management operations',
  notes: 'This operation authenticates an administrative role for the server. The user is asked to authenticate their GitHub identity, and are assigned permissions based on team-membership. Operations are henceforth authenticated via an encrypted session cookie.',
  tags: ['api'],

  validate: {
    query: Joi.object().keys({
      code: Joi.string().optional().description('an opaque string identifying an oauth flow'),
      refresh: Joi.any(),
      state: Joi.string().optional().description('an opaque string')
    }).unknown(true)
  }
}

/*
   GET /v1/logout
 */

v1.logout = {
  handler: (runtime) => {
    return async (request, h) => {
      const debug = braveHapi.debug(module, request)
      const credentials = request.auth.credentials
      const suffix = ' at ' + os.hostname() + ' ' + npminfo.name + '@' + npminfo.version +
            (process.env.DYNO ? ' at ' + process.env.DYNO : '') + ' from ' + whitelist.ipaddr(request)

      if (credentials) {
        runtime.notify(debug, {
          channel: '#devops-bot',
          text: 'logout ' + credentials.provider + ' ' +
            JSON.stringify(underscore.pick(credentials.profile, ['username', 'displayName', 'email', 'id'])) +
': ' + JSON.stringify(credentials.scope) + suffix
        })
      } else {
        runtime.notify(debug, {
          channel: '#devops-bot',
          text: 'logout' + suffix
        })
      }

      request.cookieAuth.clear()
      return h.redirect(runtime.login.github.bye)
    }
  },

  description: 'Logs the user out',
  notes: 'Used to remove the authenticating session cookie.',
  tags: ['api']
}

module.exports.routes = [
  braveHapi.routes.async().method(['GET', 'POST']).path('/v1/login').whitelist().config(v1.login),
  braveHapi.routes.async().path('/v1/logout').config(v1.logout)
]
