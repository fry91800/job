#!/bin/sh
# Daily database dump (DEPLOYMENT.md): pg_dump custom format (compressed; restore with
# pg_restore), one file per day in /backups, files older than BACKUP_KEEP_DAYS removed.
# `sh /backup.sh now` makes one dump immediately and exits.
set -eu

dump() {
  file="/backups/job-$(date -u +%Y-%m-%dT%H%M).dump"
  pg_dump --format=custom --file="$file.partial" && mv "$file.partial" "$file"
  echo "$(date -u +%FT%TZ) backup written: $file ($(du -h "$file" | cut -f1))"
  find /backups -name 'job-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -print -delete
}

if [ "${1:-}" = "now" ]; then
  dump
  exit 0
fi

while true; do
  # Sleep until the next BACKUP_HOUR:00 UTC.
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%F) ${BACKUP_HOUR:-2}:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump || echo "$(date -u +%FT%TZ) backup FAILED"
done
