#!/bin/sh
# Backups, run inside the `backup` container of docker-compose.prod.yml.
#
#   backup.sh loop    once a day at BACKUP_HOUR (default 02, the container's clock, UTC)
#   backup.sh once    now; deploy.sh does this before every deploy
#
# Each run writes into /backups:
#   daily/smaran-<stamp>.dump        pg_dump custom format, checked with pg_restore --list before it is kept
#   daily/media-<stamp>.tar.gz       the family's photographs and voice notes
#   weekly/...                       the Sunday run is copied here
# and keeps the newest KEEP_DAILY daily sets and KEEP_WEEKLY weekly ones. A file is written under a
# temporary name and renamed when complete, so a run that dies leaves no half-written backup that looks real.
# A backup that has never been restored is a hope: docs/RUNBOOK.md has the restore, and deploy/rehearse.sh (stage 5) restores one on every CI run.
set -eu

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
BACKUP_HOUR="${BACKUP_HOUR:-02}"
DIR=/backups

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

keep_newest() { # keep_newest DIR PATTERN N
  ls -1t "$1"/$2 2>/dev/null | tail -n +"$(($3 + 1))" | while read -r old; do rm -f -- "$old"; log "removed $old"; done
}

run_once() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  mkdir -p "$DIR/daily" "$DIR/weekly"

  tmp="$DIR/daily/.smaran-$stamp.dump.tmp"
  pg_dump --format=custom --no-owner --file="$tmp"
  pg_restore --list "$tmp" > /dev/null   # a dump that cannot even be listed is not a backup
  mv "$tmp" "$DIR/daily/smaran-$stamp.dump"

  if [ -d /media ] && [ -n "$(ls -A /media 2>/dev/null)" ]; then
    tmp="$DIR/daily/.media-$stamp.tar.gz.tmp"
    tar -C /media -czf "$tmp" .
    mv "$tmp" "$DIR/daily/media-$stamp.tar.gz"
  fi

  if [ "$(date -u +%u)" = 7 ]; then
    cp "$DIR/daily/smaran-$stamp.dump" "$DIR/weekly/"
    [ -f "$DIR/daily/media-$stamp.tar.gz" ] && cp "$DIR/daily/media-$stamp.tar.gz" "$DIR/weekly/"
  fi

  keep_newest "$DIR/daily" 'smaran-*.dump' "$KEEP_DAILY"
  keep_newest "$DIR/daily" 'media-*.tar.gz' "$KEEP_DAILY"
  keep_newest "$DIR/weekly" 'smaran-*.dump' "$KEEP_WEEKLY"
  keep_newest "$DIR/weekly" 'media-*.tar.gz' "$KEEP_WEEKLY"
  log "done: smaran-$stamp.dump ($(wc -c < "$DIR/daily/smaran-$stamp.dump") bytes)"
}

seconds_until_hour() {
  now=$(date -u +%s)
  h=$(date -u +%H); m=$(date -u +%M); s=$(date -u +%S)
  since_midnight=$(( 10#$h * 3600 + 10#$m * 60 + 10#$s ))
  target=$(( 10#$BACKUP_HOUR * 3600 ))
  wait=$(( target - since_midnight ))
  [ "$wait" -le 0 ] && wait=$(( wait + 86400 ))
  echo "$wait"
}

case "${1:-}" in
  once) run_once ;;
  loop)
    log "will back up daily at $BACKUP_HOUR:00 UTC, keeping $KEEP_DAILY daily and $KEEP_WEEKLY weekly"
    while true; do
      sleep "$(seconds_until_hour)"
      run_once || log "FAILED"
      sleep 61
    done ;;
  *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
