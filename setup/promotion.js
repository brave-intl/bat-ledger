const curl = require('./curl')
const data = {'grants': [ 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ' ], 'promotions': [{'active': true, 'priority': 0, 'promotionId': '902e7e4d-c2de-4d5d-aaa3-ee8fee69f7f3'}]}
const path = '/v1/grants'
curl({ path }, data).then(() => process.exit(0), () => process.exit(1))
