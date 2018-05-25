# bat-ledger
BAT back-end servers (ledger, eyeshade, balance, and helper)

## Initialization
Authentication is achieved via a GitHub [OAuth application](https://github.com/settings/developers). Create a developer application with an authorization callback of the form `https://{DOMAIN:PORT}/v1/login`.  Set the environment variables `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to those corresponding in your OAuth application.

Authorization is achieved by verifying that the user is a member of a GitHub organization, i.e., `https://github.com/orgs/{ORGANIZATION}/teams`.  Set the `GITHUB_ORG` environment variable to this address.

## Setup
1. Clone the repo: `git clone https://github.com/brave-intl/bat-ledger.git`
2. Install CMake: `brew update && brew install cmake`
3. Install Redis: `brew install redis`
4. Install MongoDB: `brew install mongodb`
5. Set MongoDB URI env variable: `export MONGODB_URI=localhost/test`
6. Install the dependencies `npm install`
7. Start Redis `brew services start redis`
8. Start MongoDB `brew services start mongodb`
9. Start with `npm run start-[ledger|eyeshade|balance|helper]`

If you get an error when starting a service, try clearing the Redis database:
```
redis-cli
  > flushdb
```

## Running locally with docker-compose

First, [install docker and docker compose](https://docs.docker.com/compose/install/).

Check out https://github.com/brave-intl/bat-ledger

You can add any environment variables that need to be set by creating a `.env`
file at the top of the repo. Docker compose will automatically load from this
file when launching services.

e.g. you might have the following in `.env`:
```
PUBLISHERS_TOKEN=foo
PUBLISHERS_URL=http://docker.for.mac.localhost:3000
```

```
# Build the base image:
docker-compose build

# (Optional) Build the bat-go image according to instructions @ https://github.com/brave-intl/bat-go

# 1. If you built bat-go you can then bring up all services (ledger, eyeshade, balance and grant)
docker-compose up

# 2. If you did not build bat-go, limit the services being brought up to exclude the grant service
docker-compose up ledger-web ledger-worker eyeshade-web eyeshade-worker balance-web

# Logs from all services presented interleaved, you can press ctrl-c to stop.
# Ledger listens on port 3001, eyeshade on 3002, and balance on 3003

# Note you can run any subset of services (e.g. only eyeshade)
docker-compose up eyeshade-web eyeshade-worker

# You can also launch and run services in the background
docker-compose up -d eyeshade-web eyeshade-worker

# And stop running background services with
docker-compose stop
```

### Configuration
Configuration variables are stored as environment preferences. See `config.js` for a list of these variables for ledger, eyeshade, balance, and helper respectively.

If you intend to run eyeshade in communication with the [publisher's website](https://github.com/brave-intl/publishers), you will need to set the `UPHOLD_CLIENT_ID` and `UPHOLD_CLIENT_SECRET` environment variables to the same as those used on your copy of the publishers site.

### StandardJS
For linting we use StandardJS. It's recommended that you install the necessary IDE plugin. Since this repo uses ES7 features, you'll need a global install of both the standard and babel-eslint packages.


## Running tests

**Please note:** Some tests access live APIs and require auth tokens which are not stored in the repo.

### Prepare .env file

1. Copy example over: `cp .env.example .env`.
2. Confirm .env vars match the contents of `.travis.yml` section env.global.
3. Fill in the remaining `{CHANGE_ME}` .env vars appropriately; please consult your local BAT dev to find the answers.

### Build local servers

```sh
npm run docker-build
```

### Start local servers

```sh
npm run docker-up
```

### Run tests
best to do in another terminal

```sh
npm run docker-test
```