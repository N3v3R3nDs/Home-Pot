#!/usr/bin/env bash
# Home Pot — backup + upload to cloud storage via rclone.
#
# Prereq on the server (one time):
#   1. apt install rclone   (or download from rclone.org)
#   2. rclone config        (set up an "hp-backup" remote — S3 / B2 / R2 / Drive / etc.)
#
# Then schedule nightly:
#   30 4 * * *  cd /opt/home-pot && /opt/home-pot/scripts/backup-cloud.sh \
#               >> /var/log/home-pot-backup.log 2>&1
#
# Override defaults via env:
#   RCLONE_REMOTE=hp-backup:home-pot   (default)
#   RETAIN_LOCAL_DAYS=7                (only keep 7 days of local copies)
#   RETAIN_CLOUD_DAYS=90               (cloud retention)

set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE="${RCLONE_REMOTE:-hp-backup:home-pot}"
RETAIN_LOCAL_DAYS="${RETAIN_LOCAL_DAYS:-7}"
RETAIN_CLOUD_DAYS="${RETAIN_CLOUD_DAYS:-90}"

echo "▶ creating local backup"
./scripts/backup.sh

LATEST=$(ls -1t backups/home-pot-*.sql.gz | head -1)
if [ -z "$LATEST" ]; then
  echo "✗ no backup file found in ./backups" >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone not installed — local backup at $LATEST" >&2
  exit 1
fi

echo "▶ uploading $LATEST → $REMOTE/"
rclone copy "$LATEST" "$REMOTE/" --progress --stats-one-line

echo "▶ pruning old local backups (>$RETAIN_LOCAL_DAYS days)"
find backups -name 'home-pot-*.sql.gz' -mtime "+$RETAIN_LOCAL_DAYS" -print -delete || true

echo "▶ pruning old cloud backups (>$RETAIN_CLOUD_DAYS days)"
rclone delete "$REMOTE" --min-age "${RETAIN_CLOUD_DAYS}d" || true

echo "✓ done — uploaded $LATEST to $REMOTE/"
