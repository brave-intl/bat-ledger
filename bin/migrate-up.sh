#!/bin/sh
sleep 3
cat ./migrations/*/up.sql | psql $DATABASE_URL --single-transaction -v ON_ERROR_STOP=1
