const curl = require('./curl')
const data = {'adFree': {'fee': {'USD': 5}, 'votes': 5, 'altcurrency': 'BAT', 'probi': '27116311373482831368'}}
const path = '/v2/surveyor/contribution'
curl({path}, data).then(() => process.exit(0), () => process.exit(1))
