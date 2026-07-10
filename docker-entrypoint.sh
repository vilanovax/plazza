#!/bin/sh
# Runs on container start: apply migrations, seed the admin, then serve.
# Both steps are idempotent, so restarts are safe.
set -e

echo "→ Applying database migrations..."
npm run db:migrate

echo "→ Seeding default admin..."
npm run db:seed

echo "→ Starting Plazza server..."
exec node .server/server.cjs
