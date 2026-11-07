#!/usr/bin/env bash
# ==========================================
# TEM BARBER - SCRIPT DE BACKUP POSTGRESQL
# ==========================================
# Uso: ./backup-postgres.sh
# Variáveis opcionais de ambiente:
#   BACKUP_DIR      (padrão: /var/backups/tembarber)
#   DB_CONTAINER    (padrão: tembarber-postgres)
#   DB_USER         (padrão: tembarber)
#   DB_NAME         (padrão: tembarber_prod)
#   RETENTION_DAYS  (padrão: 7)

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tembarber}"
DB_CONTAINER="${DB_CONTAINER:-tembarber-postgres}"
DB_USER="${DB_USER:-tembarber}"
DB_NAME="${DB_NAME:-tembarber_prod}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql.gz"
TMP_FILE="${BACKUP_FILE}.tmp.$$"
TMP_ERR="${BACKUP_FILE}.err.$$"

cleanup() {
  rm -f "$TMP_FILE" "$TMP_ERR"
}
trap cleanup EXIT ERR INT TERM

echo "=========================================="
echo "[$(date -Iseconds)] Iniciando backup do banco de dados (${DB_NAME})..."

mkdir -p "$BACKUP_DIR"

# Verificar se o container está em execução antes de iniciar o dump
if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q '^true$'; then
  echo "❌ ERRO: Container '${DB_CONTAINER}' não está em execução." >&2
  exit 1
fi

# Executar pg_dump SEM flag -t (TTY) para evitar corrupção do stream SQL/gzip com CR/LF ou avisos de terminal
if ! docker exec -i "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  2>"$TMP_ERR" | gzip -9 > "$TMP_FILE"; then
  echo "❌ ERRO: Falha na execução do pg_dump no container '${DB_CONTAINER}'." >&2
  if [ -s "$TMP_ERR" ]; then
    cat "$TMP_ERR" >&2
  fi
  exit 1
fi

if [ -s "$TMP_ERR" ]; then
  echo "⚠️ Avisos do pg_dump:" >&2
  cat "$TMP_ERR" >&2
fi

# 1. Validar que o arquivo temporário existe e não está vazio
if [ ! -s "$TMP_FILE" ]; then
  echo "❌ ERRO: O arquivo de backup gerado está vazio." >&2
  exit 1
fi

# 2. Validar integridade do arquivo gzip
if ! gzip -t "$TMP_FILE"; then
  echo "❌ ERRO: O arquivo gzip gerado está corrompido." >&2
  exit 1
fi

# 3. Validar marcadores de cabeçalho e rodapé do pg_dump em leitura completa (evita SIGPIPE com pipefail)
if ! gzip -dc "$TMP_FILE" | awk '
  /PostgreSQL database dump/ { header = 1 }
  /PostgreSQL database dump complete/ { footer = 1 }
  END { exit !(header && footer) }
'; then
  echo "❌ ERRO: O dump SQL não contém os marcadores completos de início e término do PostgreSQL." >&2
  exit 1
fi

# Promover arquivo temporário validado para o destino final de forma atômica
mv "$TMP_FILE" "$BACKUP_FILE"
rm -f "$TMP_ERR"

# Gerar hash SHA-256 para verificação antes de restore
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256")
fi

echo "✅ Backup concluído e verificado com sucesso: $BACKUP_FILE"
echo "📦 Tamanho do arquivo: $(du -h "$BACKUP_FILE" | cut -f1)"

# Rotação de backups antigos (somente após sucesso confirmado do backup atual)
echo "🧹 Removendo backups com mais de $RETENTION_DAYS dias..."
find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "db_backup_*.sql.gz.sha256" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$(date -Iseconds)] Processo de backup finalizado."
echo "=========================================="
