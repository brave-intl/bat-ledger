import test from 'ava'
import Wallet from './runtime-wallet'
import utils from './extras-utils'
import dotenv from 'dotenv'
dotenv.config()

test('selectGrants: does not err when nothing is passed in', async t => {
  t.plan(0)
  Wallet.selectGrants()
})
test('selectGrants: returns a new array', async t => {
  t.plan(1)
  const grants = []
  const selected = Wallet.selectGrants(grants)
  t.not(grants, selected)
})
test('selectGrants: filters non active grants and sorts by expiry time', async t => {
  t.plan(2)
  const status = 'active'
  const token1 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiJhNDMyNjg1My04NzVlLTQ3MDgtYjhkNS00M2IwNGMwM2ZmZTgiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiI5MDJlN2U0ZC1jMmRlLTRkNWQtYWFhMy1lZThmZWU2OWY3ZjMiLCJtYXR1cml0eVRpbWUiOjE1MTUwMjkzNTMsImV4cGlyeVRpbWUiOjE4MzAzODkzNTN9.8M5dpr_rdyCURd7KBc4GYaFDsiDEyutVqG-mj1QRk7BCiihianvhiqYeEnxMf-F4OU0wWyCN5qKDTxeqait_BQ'
  const token2 = 'eyJhbGciOiJFZERTQSIsImtpZCI6IiJ9.eyJhbHRjdXJyZW5jeSI6IkJBVCIsImdyYW50SWQiOiI0Y2ZjMzFmYy1mYjE1LTRmMTUtOTc0Zi0zNzJiMmI0YzBkYjYiLCJwcm9iaSI6IjMwMDAwMDAwMDAwMDAwMDAwMDAwIiwicHJvbW90aW9uSWQiOiJjOTZjMzljOC03N2RkLTRiMmQtYThkZi0yZWNmODI0YmM5ZTkiLCJtYXR1cml0eVRpbWUiOjE1MjY5NDE0MDAsImV4cGlyeVRpbWUiOjE1MjUxNzYwMDB9.iZBTNb9zilKubYYwYuc9MIUHZq0iv-7DsmnNu0GakeiEjcNqgbgbg-Wc2dowlMmMyjRbXjDUIC8rK4FiIqH8CQ'
  const grant1 = { status, token: token1 }
  const grant2 = { status, token: token2 }
  const grants = [grant1, grant2]
  const selected = Wallet.selectGrants(grants)
  t.deepEqual(selected, [grant2, grant1])
  t.true(utils.extractJws(token1).expiryTime > utils.extractJws(token2).expiryTime)
})
