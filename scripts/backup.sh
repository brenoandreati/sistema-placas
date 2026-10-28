#!/usr/bin/env bash
# Backup do banco com pg_dump (formato custom, comprimido).
# Uso: npm run backup            (usa DATABASE_URL do .env)
#      BACKUP_DIR=/mnt/backups RETENTION_DAYS=30 npm run backup
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:?Defina DATABASE_URL ou BACKUP_DATABASE_URL}}"
URL="${URL%%\?*}" # remove parâmetros (?schema=...) não aceitos pelo pg_dump
DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/placas_${STAMP}.dump"

mkdir -p "$DIR"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$URL"
pg_restore --list "$FILE" > /dev/null # valida que o arquivo é legível
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup criado: $FILE ($(du -h "$FILE" | cut -f1))"

find "$DIR" -name 'placas_*.dump*' -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/Removido (retenção): /'
