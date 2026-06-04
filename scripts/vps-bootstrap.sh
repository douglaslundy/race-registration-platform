#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-/opt/sistema-inscricoes-corridas}"

if [ ! -f "$APP_DIR/.env.production" ]; then
  echo "Missing $APP_DIR/.env.production"
  exit 1
fi

cd "$APP_DIR"

docker compose --env-file .env.production up -d db
docker compose --env-file .env.production build --no-cache app
docker compose --env-file .env.production run --rm -u root app sh -lc './node_modules/.bin/prisma migrate deploy'
docker compose --env-file .env.production run --rm -u root app sh -lc './node_modules/.bin/prisma db push --accept-data-loss'
docker compose --env-file .env.production run --rm -u root app sh -lc './node_modules/.bin/prisma db seed'
docker compose --env-file .env.production up -d app

docker compose --env-file .env.production ps
