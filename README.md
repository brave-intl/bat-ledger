# bat-ledger
BAT back-end servers (ledger, eyeshade, and balance)

## Running locally with docker-compose
**It is important to configure your `.env` file before attemptiing to bring up the services . See `Prepare .env file` below**

First, [install docker and docker compose](https://docs.docker.com/compose/install/).

Check out https://github.com/brave-intl/bat-ledger

You can add any environment variables that need to be set by creating a `.env`
file at the top of the repo. Docker compose will automatically load from this
file when launching services.

```

# To bring up all the services :
    docker-compose up

# Logs from all services presented interleaved, you can press ctrl-c to stop.
# Ledger listens on port 3001, eyeshade on 3002, and balance on 3003

# Note you can run any subset of services (e.g. only eyeshade)
docker-compose up eyeshade-web eyeshade-consumer

# You can also launch and run services in the background
docker-compose up -d eyeshade-web eyeshade-consumer

# And stop running background services with
docker-compose stop
```

### Docker Compose Network Configuration

All containers running within the legders docker-compose context are running in the default network named "ledger".  If you need to have other docker containers
directly access other containers from within the network (i.e. from WITHIN the container itself, not on your local development context), you can configure your application (i.e. publishers) to join the external network "ledger" by adding the following to the network configuration of the appropriate application's docker compose file


```
networks:
  ledger:
      external: true
```

### Configuration
Configuration variables are stored as environment preferences. See `config.js` for a list of these variables for ledger, eyeshade, and balance respectively.

If you intend to run eyeshade in communication with the [publisher's website](https://github.com/brave-intl/publishers), you will need to set the `UPHOLD_CLIENT_ID` and `UPHOLD_CLIENT_SECRET` environment variables to the same as those used on your copy of the publishers site.

### StandardJS
For linting we use StandardJS. It's recommended that you install the necessary IDE plugin. Since this repo uses ES7 features, you'll need a global install of both the standard and babel-eslint packages.


## Running tests

**Please note:** Some tests access live APIs and require auth tokens which are not stored in the repo.

### Prepare .env file

1. Copy example over: `cp .env.example .env`.
2. Confirm .env vars match the contents of `.github/workflows/ci.yaml` section `env`.
3. Fill in the remaining `{CHANGE_ME}` .env vars appropriately; please consult your local BAT dev to find the answers.

### Running Individial tests

`bat-ledgers` is executing tests using `ava` which can be executed via `npm run ava` and the requires args for any individual test can be passed to the command using `npm` scripts args syntax.  See below:

`npm run ava -- -v -s eyeshade/workers/referrals.test.js`

Or, if invoking the container externally,

`docker-compose run eyeshade-web npm run ava -- -v -s test/eyeshade/suggestions.integration.test.js`

See the [github issue where this ability was added](https://github.com/npm/npm/pull/5518)


### Build local servers

```sh
npm run docker-build
```

### Start local servers

```sh
npm run docker-up
```
### Postgres migrations

You can run all migrations to upgrade the schema to the latest version using:

```sh
npm run docker-migrate-up
```

You can reverse a particular migration by running:

```sh
npm run docker-migrate-down -- migrations/0001_transactions/down.sql
```

### Run tests
best to do in another terminal

```sh
npm run docker-test
```

## Testing contribution

If you are testing contributions locally (not with e2e automated tests) you need to add surveyors manually.
You can do this by running bellow command when ledger service is running.
```
curl -X POST --header 'Authorization: Bearer foobarfoobar' --header 'Content-Type: application/json' --header 'Accept: application/json' -d '{"adFree":{"fee":{"USD":5},"votes":50,"altcurrency":"BAT","probi":"27116311373482831368"}}' 'http://127.0.0.1:3001/v2/surveyor/contribution'
```

## Debugging
```sh
docker-compose run --rm -p 9229:9229 eyeshade-web npm run start-eyeshade -- --inspect=0.0.0.0
```

## gyp

You may have to install `node-gyp` if you do not already have it on your machine. Use this document to install: https://github.com/nodejs/node-gyp#installation. Catalina users may have a longer road.

## npm install
you may also have to use npm without running the postinstall scripts. use the `--ignore-scripts` flag.
