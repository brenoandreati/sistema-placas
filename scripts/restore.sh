#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh em um banco VAZIO.
# Uso: TARGET_DATABASE_URL=postgresql://... bash scripts/restore.sh backups/placas_YYYYMMDDTHHMMSSZ.dump
set -euo pipefail

FILE="${1:?Informe o arquivo .dump}"
URL="${TARGET_DATABASE_URL:?Defina TARGET_DATABASE_URL (banco de destino, de preferência novo e vazio)}"
URL="${URL%%\?*}"

if [ -f "$FILE.sha256" ]; then
  sha256sum --check "$FILE.sha256"
fi

TABLES=$(psql "$URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$TABLES" != "0" ] && [ "${FORCE_RESTORE:-}" != "1" ]; then
  echo "O banco de destino já possui $TABLES tabela(s). Use um banco vazio ou FORCE_RESTORE=1 (sobrescreve)." >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$URL" "$FILE"
echo "Restauração concluída. Confira com: DATABASE_URL=... npx prisma migrate status"
