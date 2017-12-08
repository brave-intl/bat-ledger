# Developer Setup
1. Install CMake `brew install cmake`
2. Install Redis `brew install redis`
3. Install MongoDB `brew install mongodb`
4. Set MongoDB env variable for eyeshade use `export MONGODB_URI=localhost/test`
5. Install the dependencies `npm install`
6. Start with `npm run start-[ledger|eyeshade|balance|helper]`

If you get an error when starting a service, try clearing the Redis database:
```
redis-cli
 > flushdb
```