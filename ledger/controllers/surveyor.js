const boom = require('boom')

const utils = require('bat-utils')
const braveHapi = utils.extras.hapi

const v1 = {}
const v2 = {}

/*
   GET /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.read =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   POST /v2/surveyor/{surveyorType}
 */

v2.create =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   PATCH /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.update =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   GET /v2/surveyor/{surveyorType}/{surveyorId}/{uId}
 */

v2.phase1 =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   PUT /v2/surveyor/{surveyorType}/{surveyorId}
 */

v2.phase2 =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   GET /v1/surveyor/voterate/{surveyorType}/{surveyorId}
*/

v1.getVoteRate =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   POST /{apiV}/batch/surveyor/voting
 */

v2.batchVote =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

/*
   GET /{apiV}/batch/surveyor/voting/{uId}
 */

v2.batchSurveyor =
{
  handler: () => {
    return async () => {
      throw boom.resourceGone()
    }
  }
}

module.exports.routes = [
  braveHapi.routes.async().path('/v1/surveyor/voterate/{surveyorType}/{surveyorId}').config(v1.getVoteRate),
  braveHapi.routes.async().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.read),
  braveHapi.routes.async().post().path('/{apiV}/surveyor/{surveyorType}').config(v2.create),
  braveHapi.routes.async().patch().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.update),
  braveHapi.routes.async().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}/{uId}').config(v2.phase1),
  braveHapi.routes.async().put().path('/{apiV}/surveyor/{surveyorType}/{surveyorId}').config(v2.phase2),
  braveHapi.routes.async().post().path('/{apiV}/batch/surveyor/voting').config(v2.batchVote),
  braveHapi.routes.async().path('/{apiV}/batch/surveyor/voting/{uId}').config(v2.batchSurveyor)
]
