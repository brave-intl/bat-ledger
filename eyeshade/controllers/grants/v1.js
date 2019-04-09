const Joi = require('joi')
const paymentId = Joi.string().guid().required().description('identity of the wallet')
const grantValidator = Joi.object().keys({
  type: Joi.string().description('the type of grant'),
  id: Joi.string().guid().required().description('the grant-identifier')
})
const grants = Joi.array().items(grantValidator).description('a list of grants to retrieve')
const simpleAuth = {
  strategy: 'simple-scoped-token',
  scope: ['publishers'],
  mode: 'required'
}

module.exports = {
  getGrants: {
    handler: getHandler,
    auth: simpleAuth,
    tags: [ 'api', 'grants' ],
    description: 'get grants for a wallet id',
    validate: {
      params: Joi.object().keys({ paymentId }).description('get handler params')
    },
    response: {
      schema: Joi.object().keys({ grants }).description('grants available to the given payment id')
    }
  }
}

function getHandler (runtime) {
  return async (request, reply) => {
    const grants = []
    reply({
      grants
    })
  }
}
