const bson = require('bson')

exports.initialize = async (debug, runtime) => {
  if (runtime.config.database.mongo2) {
    runtime.database2 = new runtime.database.constructor({ database: runtime.config.database.mongo2 }, runtime)
  }

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('tseries', debug),
      name: 'tseries',
      property: 'series_1_timestamp',
      empty: {
        series: '',
        timestamp: '',

        count: bson.Decimal128.POSITIVE_ZERO,
        source: '',
        seqno: ''
      },
      unique: [ { series: 1, timestamp: 1 }, { series: 1, seqno: 1 } ],
      others: [ { series: 1 }, { timestamp: 1 }, { count: 1 }, { source: 1 }, { seqno: 1 } ]
    }
  ])
}
