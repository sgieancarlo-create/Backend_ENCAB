#!/usr/bin/env bash
# Simple MySQL dump backup script
set -e
HOST=${DB_HOST:-localhost}
USER=${DB_USER:-root}
PASS=${DB_PASSWORD:-}
DB=${DB_NAME:-enrollment}
OUT=${OUT:-./backups}

mkdir -p "$OUT"
FILE="$OUT/${DB}_$(date +%F_%H%M%S).sql"

echo "Backing up $DB to $FILE"
mysqldump -h "$HOST" -u "$USER" -p"$PASS" "$DB" > "$FILE"

echo "Backup complete: $FILE"
