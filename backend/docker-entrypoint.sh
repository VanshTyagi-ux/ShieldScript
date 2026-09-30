#!/bin/sh
# Container entrypoint: make sure the database has its tables and the payloads, then run the command
# (uvicorn, by default). Seeding is safe to repeat: rows that are already stored are skipped.
#
#   SEED_ON_START=false   skip seeding (the tables are then NOT created either)
#   SEED_RETRIES=15       how many times to try if the database is not accepting connections yet
#   SEED_RETRY_DELAY=2    seconds between tries
set -eu

if [ "${SEED_ON_START:-true}" = "true" ]; then
  tries=0
  max="${SEED_RETRIES:-15}"
  until python -m scripts.seed_payloads; do
    tries=$((tries + 1))
    if [ "$tries" -ge "$max" ]; then
      echo "docker-entrypoint: seeding still failing after $tries tries; giving up" >&2
      exit 1
    fi
    echo "docker-entrypoint: seeding failed (try $tries of $max); is the database up? retrying in ${SEED_RETRY_DELAY:-2}s" >&2
    sleep "${SEED_RETRY_DELAY:-2}"
  done
fi

exec "$@"
