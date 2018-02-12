const bson = require('bson')

exports.initialize = async (debug, runtime) => {
  if (runtime.config.database.mongo2) {
    runtime.database2 = new runtime.database.constructor({ database: runtime.config.database.mongo2 }, runtime)
  }

  const database = runtime.database2 || runtime.database

  database.checkIndices(debug, [
    {
      category: runtime.database.get('pseries', debug),
      name: 'pseries',
      property: 'tsId',
      empty: {
        publisher: '',
        tsId: bson.ObjectID.createFromTime(0),

        providerName: '',
        providerSuffix: '',
        providerValue: '',

        // websites
        site: {},

        // video channels
        snippet: {},
        statistics: {},

        // reason for failure
        reason: '',

        timestamp: bson.Timestamp.ZERO
      },
      unique: [ { tsId: 1 } ],
      others: [ { providerName: 1 }, { providerSuffix: 1 }, { providerValue: 1 },
                { views: 1 }, { comments: 1 }, { subscribers: 1 }, { videos: 1 },
                { timestamp: 1 } ]
    }
  ])

  await runtime.queue.create('report-publishers-monthly-contributions')
  await runtime.queue.create('report-publishers-collector-contributions')
}
