exports.initialize = async (debug, runtime) => {
  if (runtime.config.database.mongo2) {
    runtime.database2 = new runtime.database.constructor({ database: runtime.config.database.mongo2 }, runtime)
  }

  runtime.database.checkIndices(debug, [
    {
      category: runtime.database.get('series', debug),
      name: 'series',
      property: 'key_1_time',
      empty: {
        key: '',
        time: '',

        count: 0,
        source: '',
        seqno: ''
      },
      unique: [ { key: 1, time: 1 } ],
      others: [ { source: 1, seqno: 1 } ]
    }
  ])
}
