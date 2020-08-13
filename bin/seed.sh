#!/bin/sh
psql $DATABASE_URL -U eyeshade --single-transaction -v ON_ERROR_STOP=1 -f ./migrations/0010_geo_referral/seeds/groups.sql
psql $DATABASE_URL -U eyeshade --single-transaction -v ON_ERROR_STOP=1 -f ./migrations/0010_geo_referral/seeds/countries.sql
psql $DATABASE_URL -U eyeshade --single-transaction -v ON_ERROR_STOP=1 -f ./migrations/0016_geo_referral/seeds/countries.sql
