#!/usr/bin/env bash
# Run SQL migrations against the configured MySQL database
set -e
HOST=${DB_HOST:-localhost}
USER=${DB_USER:-root}
PASS=${DB_PASSWORD:-}
DB=${DB_NAME:-enrollment}

for f in $(ls migrations/*.sql | sort); do
  echo "Applying $f"
  mysql -h "$HOST" -u "$USER" -p"$PASS" "$DB" < "$f"
done

echo "Migrations applied"
