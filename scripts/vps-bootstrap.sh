#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-/opt/sistema-inscricoes-corridas}"

if [ ! -f "$APP_DIR/.env.prod.local" ]; then
  echo "Missing $APP_DIR/.env.prod.local"
  exit 1
fi

cd "$APP_DIR"

docker compose --env-file .env.prod.local build --no-cache app
docker compose --env-file .env.prod.local run --rm -u root app sh -lc './node_modules/.bin/prisma db push --accept-data-loss'
docker compose --env-file .env.prod.local run --rm -u root app sh -lc './node_modules/.bin/prisma db seed'
docker compose --env-file .env.prod.local up -d app

docker compose --env-file .env.prod.local ps
