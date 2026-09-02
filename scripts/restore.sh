#!/usr/bin/env bash
#
# scripts/restore.sh — restore the Docker Compose Postgres database from a
# backup file produced by scripts/backup.sh.
#
# THIS IS DESTRUCTIVE: it drops and recreates every object in the target
# database before loading the backup, overwriting whatever is there now.
# It asks for confirmation before doing anything irreversible.
#
# Usage:
#   ./scripts/restore.sh <path-to-backup-file>
#   e.g. ./scripts/restore.sh backups/glass_ops_20260315T120000Z.dump
#
# Requires the Compose stack to be up (docker compose up -d). Does not touch
# any non-Docker (native/local) Postgres install on this machine — it only
# ever talks to the "postgres" service over the Compose network.

set -euo pipefail

COMPOSE_SERVICE="${COMPOSE_POSTGRES_SERVICE:-postgres}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The Compose stack's credentials live in .env.docker, not .env — this
# project's local dev server also reads a root-level .env, which is
# Compose's own default env-file lookup too, so this script always passes
# --env-file explicitly rather than risk picking up the wrong one (or an
# empty POSTGRES_USER/PASSWORD/DB, which docker compose only warns about,
# not errors on). See docker-compose.yml and .env.docker.example.
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$REPO_ROOT/.env.docker}"
COMPOSE=(docker compose --env-file "$COMPOSE_ENV_FILE")

usage() {
  echo "Usage: $0 <path-to-backup-file>" >&2
  echo "  e.g. $0 backups/glass_ops_20260315T120000Z.dump" >&2
}

if [ "$#" -ne 1 ]; then
  echo "error: expected exactly one argument (the backup file path), got $#." >&2
  usage
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "error: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_ENV_FILE" ]; then
  echo "error: env file not found: $COMPOSE_ENV_FILE" >&2
  echo "       create it first: cp .env.docker.example .env.docker (then edit it)" >&2
  exit 1
fi

if [ -z "$("${COMPOSE[@]}" ps -q "$COMPOSE_SERVICE" 2>/dev/null)" ]; then
  echo "error: the '$COMPOSE_SERVICE' Compose service isn't running." >&2
  echo "       start the stack first: docker compose --env-file .env.docker up -d" >&2
  exit 1
fi

echo "==> Restoring the Docker Compose Postgres database"
echo "    service: $COMPOSE_SERVICE"
echo "    from:    $BACKUP_FILE"
echo
echo "WARNING: this overwrites the database's current contents. Every table"
echo "         will be dropped and recreated from the backup. This cannot be undone."
echo

read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted. No changes were made."
  exit 1
fi

echo "==> Restoring..."

# -T disables pseudo-tty allocation so the piped-in binary dump isn't
# mangled. --clean --if-exists drops existing objects first (so leftover
# objects not in the backup don't linger); --no-owner skips ownership
# statements, since the role names inside the container may not match
# whatever created the dump. $POSTGRES_USER / $POSTGRES_DB are expanded
# inside the postgres container, from the same env vars the official
# postgres image already uses to initialize itself.
if "${COMPOSE[@]}" exec -T "$COMPOSE_SERVICE" \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < "$BACKUP_FILE"
then
  echo "==> Done. Database restored from $BACKUP_FILE"
else
  echo "error: pg_restore reported errors — check the output above." >&2
  echo "       (warnings like \"does not exist, skipping\" during --clean are normal" >&2
  echo "       on a database that didn't already have every object; a nonzero exit" >&2
  echo "       with no other output usually means the connection or file itself failed.)" >&2
  exit 1
fi
