#!/usr/bin/env bash
#
# scripts/backup.sh — back up the Docker Compose Postgres database.
#
# Runs pg_dump inside the running "postgres" Compose service and writes a
# timestamped custom-format dump (pg_dump -Fc) to backups/. Custom format is
# compressed, restore-order-independent, and is what scripts/restore.sh
# expects.
#
# Usage:
#   ./scripts/backup.sh
#
# Requires the Compose stack to be up (docker compose up -d). Does not touch
# any non-Docker (native/local) Postgres install on this machine — it only
# ever talks to the "postgres" service over the Compose network.

set -euo pipefail

COMPOSE_SERVICE="${COMPOSE_POSTGRES_SERVICE:-postgres}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/glass_ops_${TIMESTAMP}.dump"

echo "==> Backing up the Docker Compose Postgres database"
echo "    service: $COMPOSE_SERVICE"

if [ -z "$(docker compose ps -q "$COMPOSE_SERVICE" 2>/dev/null)" ]; then
  echo "error: the '$COMPOSE_SERVICE' Compose service isn't running." >&2
  echo "       start the stack first: docker compose up -d" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "    writing: $BACKUP_FILE"

# -T disables pseudo-tty allocation so binary dump data isn't mangled.
# $POSTGRES_USER / $POSTGRES_DB are expanded *inside* the postgres
# container, from the same env vars the official postgres image already
# uses to initialize itself — so this doesn't need to know credentials on
# the host side at all.
if docker compose exec -T "$COMPOSE_SERVICE" \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$BACKUP_FILE"
then
  SIZE="$(du -h "$BACKUP_FILE" | cut -f1 | tr -d '[:space:]')"
  echo "==> Done. Backup saved: $BACKUP_FILE ($SIZE)"
  echo "    Restore it with: ./scripts/restore.sh \"$BACKUP_FILE\""
else
  rm -f "$BACKUP_FILE"
  echo "error: pg_dump failed — no backup file was written." >&2
  exit 1
fi
