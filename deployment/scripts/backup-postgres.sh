#!/usr/bin/env bash
# ==========================================
# TEM BARBER - SCRIPT DE BACKUP POSTGRESQL
# ==========================================
# Uso: ./backup-postgres.sh
# Alinhado com deployment/docker-compose.yml:
#   Container padrão: tem-barber-postgres
#   Usuário/Banco padrão: lidos de POSTGRES_USER / POSTGRES_DB do container
#                         (fallback: tem_barber_user / tem_barber)
# Variáveis opcionais de ambiente:
#   BACKUP_DIR      (padrão: /var/backups/tembarber)
#   DB_CONTAINER    (padrão: tem-barber-postgres)
#   DB_USER         (opcional: sobrescreve POSTGRES_USER do container)
#   DB_NAME         (opcional: sobrescreve POSTGRES_DB do container)
#   RETENTION_DAYS  (padrão: 7)

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tembarber}"
DB_CONTAINER="${DB_CONTAINER:-tem-barber-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql.gz"
if [ -e "$BACKUP_FILE" ]; then
  BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}_$$.sql.gz"
fi
TMP_FILE="${BACKUP_FILE}.tmp.$$"
TMP_ERR="${BACKUP_FILE}.err.$$"

cleanup() {
  rm -f "$TMP_FILE" "$TMP_ERR"
}
trap cleanup EXIT ERR INT TERM

mkdir -p "$BACKUP_DIR"

# Verificar se o container esperado está em execução
if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q '^true$'; then
  echo "❌ ERRO: Container '${DB_CONTAINER}' não está em execução." >&2
  exit 1
fi

# Resolver DB_USER e DB_NAME a partir do ambiente real do container (deployment/docker-compose.yml) quando não informados
if [ -z "${DB_USER:-}" ]; then
  DB_USER="$(docker exec -i "$DB_CONTAINER" sh -c 'printf "%s" "${POSTGRES_USER:-tem_barber_user}"')"
fi
if [ -z "${DB_NAME:-}" ]; then
  DB_NAME="$(docker exec -i "$DB_CONTAINER" sh -c 'printf "%s" "${POSTGRES_DB:-tem_barber}"')"
fi

echo "=========================================="
echo "[$(date -Iseconds)] Iniciando backup do banco '${DB_NAME}' no container '${DB_CONTAINER}' (usuário '${DB_USER}')..."

# Validar conectividade e existência do banco antes de iniciar o dump
if ! docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null 2>"$TMP_ERR"; then
  echo "❌ ERRO: Não foi possível conectar ao banco '${DB_NAME}' no container '${DB_CONTAINER}' com o usuário '${DB_USER}'." >&2
  if [ -s "$TMP_ERR" ]; then
    cat "$TMP_ERR" >&2
  fi
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

# Gerar hash SHA-256 obrigatório para verificação antes de restore
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "❌ ERRO: Utilitário sha256sum não encontrado para assinar o backup." >&2
  exit 1
fi
(cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256")

echo "✅ Backup concluído e verificado com sucesso: $BACKUP_FILE"
echo "🔐 Checksum SHA-256 registrado em: ${BACKUP_FILE}.sha256"
echo "📦 Tamanho do arquivo: $(du -h "$BACKUP_FILE" | cut -f1)"

# Rotação de backups antigos (somente após sucesso confirmado do backup atual e do .sha256)
echo "🧹 Removendo backups com mais de $RETENTION_DAYS dias..."
find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "db_backup_*.sql.gz.sha256" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$(date -Iseconds)] Processo de backup finalizado."
echo "=========================================="
