#!/usr/bin/env bash
# Home Pot — daily Postgres dump backup.
#
# Usage on the server:
#   ./scripts/backup.sh                 # writes to ./backups/home-pot-YYYY-MM-DD.sql.gz
#   BACKUP_DIR=/mnt/storage/hp ./scripts/backup.sh
#
# To run nightly via cron (root crontab):
#   30 4 * * *  cd /opt/home-pot && /opt/home-pot/scripts/backup.sh >> /var/log/home-pot-backup.log 2>&1

set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
STAMP=$(date +%Y-%m-%d)
OUT="$BACKUP_DIR/home-pot-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Find the running db container — works whether the stack is named home-pot
# (local) or via Portainer (random suffix).
DB_CONTAINER=$(docker ps --filter "name=db" --filter "ancestor=supabase/postgres:15.6.1.139" --format '{{.Names}}' | head -1)
if [ -z "$DB_CONTAINER" ]; then
  echo "✗ No running supabase/postgres container found" >&2
  exit 1
fi
echo "▶ dumping from $DB_CONTAINER → $OUT"

# Dump the entire cluster (auth + public + _realtime schemas). Excludes the
# postgres internal databases. Compressed on the fly.
docker exec -e PGPASSWORD="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2)" \
  "$DB_CONTAINER" pg_dumpall -U supabase_admin --clean --if-exists \
  | gzip -9 > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "✓ wrote $OUT ($SIZE)"

# Prune old backups
find "$BACKUP_DIR" -name 'home-pot-*.sql.gz' -mtime "+$RETAIN_DAYS" -print -delete || true

echo "done."
