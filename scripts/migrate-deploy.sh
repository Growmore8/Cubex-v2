#!/bin/sh
# Run this ONCE on the production server to apply the MT5 schema migration.
# Must be executed from the project root directory.
set -e
echo "[migrate] Running prisma migrate deploy..."
npx prisma migrate deploy
echo "[migrate] Done. Restart the server (pm2 restart app / node server.js)"
