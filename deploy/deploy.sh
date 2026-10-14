#!/usr/bin/env bash
# Deploy one image tag, check it, and put the previous tag back if it does not hold.
#
#   deploy/deploy.sh sha-1a2b3c4          run on the machine, in the directory that holds .env
#
# Idempotent: running it twice with the same tag changes nothing the second time.
#
# What it does, in order:
#   1. records the tag now running (state/current_tag) as the one to go back to
#   2. takes a backup (the database is the one thing a rollback cannot undo)
#   3. pulls the new images and brings the stack up on them
#   4. waits for /actuator/health to say UP, with a timeout
#   5. runs smoke.sh against the public address
#   6. on success records the new tag; on any failure puts the old tag back and exits non-zero
#
# A rollback puts back the code, not the database. Database migrations must therefore be written so the
# previous release still runs on the new schema (add before you remove): docs/RUNBOOK.md, "Migrations".
#
# Environment (all optional):
#   HEALTH_URL           default https://$DOMAIN/actuator/health (DOMAIN is read from .env)
#   HEALTH_TIMEOUT       seconds to wait for health, default 180
#   SKIP_PULL=1          do not pull (the images are already on this machine: tests)
#   SKIP_BACKUP=1        do not take the pre-deploy backup
#   CURL_OPTS            extra curl options, for example -k for a local certificate
#   SMOKE_PASSWORD       required by smoke.sh; read from .env if set there
set -euo pipefail

cd "$(dirname "$0")"
NEW="${1:?usage: deploy.sh <image-tag>}"
mkdir -p state
exec 9>state/deploy.lock
if command -v flock >/dev/null; then
  flock -n 9 || { echo "deploy: another deploy is running" >&2; exit 3; }
fi

set -a; . ./.env; set +a
export GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER is not set (in .env or the environment)}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
HEALTH_URL="${HEALTH_URL:-https://${DOMAIN:?DOMAIN is not set in .env}/actuator/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
CURL_OPTS="${CURL_OPTS:-}"
PREV="$(cat state/current_tag 2>/dev/null || true)"

log() { printf '%s deploy: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # Both the API's health and the page itself, through the same public path a person uses.
    if curl -fsS $CURL_OPTS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"UP"'        && curl -fsS $CURL_OPTS --max-time 5 "${HEALTH_URL%/actuator/health}/" 2>/dev/null | grep -q 'id="root"'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

up() { # up TAG
  export IMAGE_TAG="$1"
  [ "${SKIP_PULL:-}" = 1 ] || "${COMPOSE[@]}" pull --quiet backend frontend
  # --wait: return only when every service is running and every health check has passed (or time out and fail).
  "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout "$HEALTH_TIMEOUT"
}

rollback() {
  if [ -z "$PREV" ]; then
    log "there is no earlier release to go back to; the failed one is left running for inspection"
    "${COMPOSE[@]}" logs --tail 80 backend || true
    return 1
  fi
  log "ROLLING BACK to $PREV"
  "${COMPOSE[@]}" logs --tail 80 backend || true
  up "$PREV"
  if wait_healthy; then
    log "rolled back: $PREV is healthy again"
  else
    log "the rollback itself is not healthy; this needs a person"
  fi
}

if [ "$PREV" = "$NEW" ] && wait_healthy; then
  log "$NEW is already deployed and healthy; nothing to do"
  exit 0
fi

log "deploying $NEW (was: ${PREV:-nothing})"
if [ "${SKIP_BACKUP:-}" != 1 ] && "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx backup; then
  log "taking a backup first"
  "${COMPOSE[@]}" exec -T backup sh /backup/backup.sh once || { log "the backup failed; not deploying"; exit 1; }
fi

if ! up "$NEW"; then
  log "could not bring $NEW up"
  rollback || true
  exit 1
fi
if ! wait_healthy; then
  log "$NEW did not become healthy within ${HEALTH_TIMEOUT}s"
  rollback || true
  exit 1
fi
log "$NEW is healthy; running the smoke test"
if ! BASE_URL="${HEALTH_URL%/actuator/health}" CURL_OPTS="$CURL_OPTS" ./smoke.sh; then
  log "the smoke test failed on $NEW"
  rollback || true
  exit 1
fi

[ -n "$PREV" ] && echo "$PREV" > state/previous_tag
echo "$NEW" > state/current_tag
echo "$(date -u +%FT%TZ) $NEW" >> state/history
docker image prune -f >/dev/null 2>&1 || true
log "deployed $NEW"
