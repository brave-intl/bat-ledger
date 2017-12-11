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

### Configuration
Configuration variables are stored as environment preferences. See `config.js` for a list of these variables for ledger, eyeshade, balance, and helper respectively.

If you intend to run eyeshade in communication with the [publisher's website](https://github.com/brave-intl/publishers), you will need to set the `UPHOLD_CLIENT_ID` and `UPHOLD_CLIENT_SECRET` environment variables to the same as those used on your copy of the publishers site.

### StandardJS
For linting we use StandardJS. It's recommended that you install the necessary IDE plugin. Since this repo uses ES7 features, you'll need a global install of both the standard and babel-eslint packages.

