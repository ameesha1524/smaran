#!/usr/bin/env bash
# A rehearsal of everything the deploy promises, on one machine, with the real scripts.
#
#   docker build -t ghcr.io/local/smaran-backend:good backend
#   docker build -t ghcr.io/local/smaran-frontend:good frontend
#   deploy/rehearse.sh
#
# It sets up a throw-away copy of the production stack (docker-compose.prod.yml, Caddy with its own local
# certificate, a database that is new each run) and then:
#
#   1. deploys the good release                       must succeed, and the smoke test must pass
#   2. deploys the same tag again                     must do nothing
#   3. deploys a release whose backend never starts   must fail, and the good release must be running again
#   4. deploys a release whose API is broken but whose
#      health check still says UP                     must fail the smoke test, and be rolled back
#   5. takes a backup, damages the database, restores   the damage must be gone and the app must be healthy
#
# The exit status is 0 only if every one of those held. CI runs this on every change, so "a deliberately broken
# deploy rolls back" is something that is checked, not something that is claimed.
#
# Needs: docker with the compose plugin, bash, curl, jq. Ports 8088 and 8443 free (HTTP_PORT, HTTPS_PORT).
# Leaves its containers' volumes behind (their names include a random suffix); `docker volume prune` removes them.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="${REHEARSAL_DIR:-${RUNNER_TEMP:-/tmp}/smaran-rehearsal}"
PROJECT="smaranrehearsal$RANDOM"
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8088}"
BACK=ghcr.io/local/smaran-backend
FRONT=ghcr.io/local/smaran-frontend

say() { printf '\n=== %s\n' "$*"; }
die() { printf 'REHEARSAL FAILED: %s\n' "$*" >&2; exit 1; }
secret() { head -c 36 /dev/urandom | base64 | tr -d '\n+/='; }

docker image inspect "$BACK:good" >/dev/null 2>&1 || die "build $BACK:good first (see the top of this file)"
docker image inspect "$FRONT:good" >/dev/null 2>&1 || die "build $FRONT:good first"

mkdir -p "$WORK"
cp "$SRC"/{deploy.sh,smoke.sh,backup.sh,restore.sh,docker-compose.prod.yml,Caddyfile} "$WORK"/
cd "$WORK"
cat > .env <<EOF
COMPOSE_PROJECT_NAME=$PROJECT
DOMAIN=localhost
GHCR_OWNER=local
POSTGRES_PASSWORD=$(secret)
JWT_SECRET=$(secret)$(secret)
EXPORT_SALT=$(secret)
SMOKE_PASSWORD=$(secret)
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
CORS_ORIGINS=https://localhost,https://localhost:$HTTPS_PORT
EOF
chmod 600 .env

export SKIP_PULL=1 CURL_OPTS=-k HEALTH_URL="https://localhost:$HTTPS_PORT/actuator/health" HEALTH_TIMEOUT=300
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
health() { curl -fsSk --max-time 5 "$HEALTH_URL" | grep -q '"status":"UP"'; }
running() { # running SERVICE -> the image tag it is running
  IMAGE_TAG=x GHCR_OWNER=local "${COMPOSE[@]}" ps --format '{{.Image}}' "$1" 2>/dev/null | head -1 | sed 's/.*://'
}

# ---- the broken releases: the good images with one thing wrong ------------------------------------------------
docker build -q -t "$BACK:broken-start" - >/dev/null <<EOF
FROM $BACK:good
ENTRYPOINT ["sh", "-c", "sleep 3600"]
EOF
docker tag "$FRONT:good" "$FRONT:broken-start"
docker build -q -t "$FRONT:broken-api" - >/dev/null <<EOF
FROM $FRONT:good
USER root
RUN sed -i 's/proxy_read_timeout 1h;/return 503;/' /etc/nginx/templates/default.conf.template
USER 101
EOF
docker tag "$BACK:good" "$BACK:broken-api"

say "1. the good release deploys, and its smoke test passes"
./deploy.sh good
[ "$(cat state/current_tag)" = good ] || die "current_tag is not good"
health || die "not healthy after the first deploy"

say "2. the same tag again does nothing"
./deploy.sh good | tee /tmp/second.log
grep -q "already deployed" /tmp/second.log || die "the second deploy of the same tag did not say so"

say "3. a release whose backend never starts is rolled back"
if ./deploy.sh broken-start; then die "a release that never starts was accepted"; fi
[ "$(cat state/current_tag)" = good ] || die "current_tag moved to a failed release"
health || die "the good release is not healthy after the rollback"
[ "$(running backend)" = good ] || die "the backend running after the rollback is $(running backend), not good"

say "4. a release that is healthy but whose API is broken fails the smoke test and is rolled back"
if ./deploy.sh broken-api; then die "a release with a broken API was accepted"; fi
[ "$(cat state/current_tag)" = good ] || die "current_tag moved to a failed release"
health || die "the good release is not healthy after the rollback"
[ "$(running frontend)" = good ] || die "the frontend running after the rollback is $(running frontend), not good"

say "5. backup, damage, restore"
export IMAGE_TAG=good GHCR_OWNER=local
"${COMPOSE[@]}" exec -T backup sh /backup/backup.sh once
DUMP="$("${COMPOSE[@]}" exec -T backup sh -c 'ls -t /backups/daily | grep dump | head -1' | tr -d '\r')"
[ -n "$DUMP" ] || die "no dump was written"
patients_before="$("${COMPOSE[@]}" exec -T db psql -U smaran -d smaran -tAc 'select count(*) from patient' | tr -d '\r')"
"${COMPOSE[@]}" exec -T db psql -U smaran -d smaran -c 'create table restore_marker(x int); insert into restore_marker values (1);' >/dev/null
./restore.sh "daily/$DUMP"
for _ in $(seq 1 40); do health && break; sleep 3; done
health || die "not healthy after the restore"
marker="$("${COMPOSE[@]}" exec -T db psql -U smaran -d smaran -tAc "select coalesce(to_regclass('restore_marker')::text, 'gone')" | tr -d '\r')"
[ "$marker" = gone ] || die "the damage is still there after the restore"
patients_after="$("${COMPOSE[@]}" exec -T db psql -U smaran -d smaran -tAc 'select count(*) from patient' | tr -d '\r')"
[ "$patients_before" = "$patients_after" ] || die "patients: $patients_before before, $patients_after after the restore"

say "the rehearsal held: deploy, idempotence, two kinds of bad release rolled back, backup and restore"
"${COMPOSE[@]}" down >/dev/null 2>&1 || true
