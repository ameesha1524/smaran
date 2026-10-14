#!/usr/bin/env bash
# Restore the database (and optionally the media) from a backup made by backup.sh.
#
#   deploy/restore.sh daily/smaran-20261009-020000.dump [daily/media-20261009-020000.tar.gz]
#
# Paths are relative to /backups in the backup container (docs/RUNBOOK.md shows how to list them). The
# application is stopped while this runs and started again afterwards. Everything written since the
# backup is lost, which is the point of choosing a backup. Replaces the whole database.
set -euo pipefail
cd "$(dirname "$0")"
DUMP="${1:?usage: restore.sh <dump under /backups> [media tarball under /backups]}"
MEDIA="${2:-}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
export IMAGE_TAG="${IMAGE_TAG:-$(cat state/current_tag 2>/dev/null || echo unknown)}"

echo "restore: stopping the application"
"${COMPOSE[@]}" stop caddy frontend backend
echo "restore: checking $DUMP"
"${COMPOSE[@]}" exec -T backup sh -c 'pg_restore --list "/backups/$1" > /dev/null' _ "$DUMP"
echo "restore: replacing the database"
"${COMPOSE[@]}" exec -T backup sh -c 'dropdb --if-exists --force "$PGDATABASE" && createdb "$PGDATABASE"'
"${COMPOSE[@]}" exec -T backup sh -c 'pg_restore --no-owner --exit-on-error --dbname "$PGDATABASE" "/backups/$1"' _ "$DUMP"
if [ -n "$MEDIA" ]; then
  # Laid over what is there: every file in the backup is put back as it was, and a file added since is left
  # alone. Photographs and voices are irreplaceable, so this never deletes one.
  echo "restore: putting the media back"
  "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh -v "${COMPOSE_PROJECT_NAME:-smaran}_media:/restore" backup \
    -c 'tar -C /restore -xzf "/backups/$1"' _ "$MEDIA"
fi
echo "restore: starting the application"
"${COMPOSE[@]}" up -d
echo "restore: done. Check the health address and sign in."
