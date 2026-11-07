#!/usr/bin/env bash
# ==========================================
# TEM BARBER - SCRIPT DE RESTAURAÇÃO POSTGRESQL
# ==========================================
# Uso: ./restore-postgres.sh /caminho/para/db_backup_YYYYMMDD_HHMMSS.sql.gz
# Variáveis opcionais de ambiente:
#   DB_CONTAINER   (padrão: tembarber-postgres)
#   DB_USER        (padrão: tembarber)
#   DB_NAME        (padrão: tembarber_prod)
#   FORCE_RESTORE  (padrão: false; definir "true" apenas em automação controlada)

set -Eeuo pipefail

DB_CONTAINER="${DB_CONTAINER:-tembarber-postgres}"
DB_USER="${DB_USER:-tembarber}"
DB_NAME="${DB_NAME:-tembarber_prod}"
FORCE_RESTORE="${FORCE_RESTORE:-false}"

if [ -z "${1:-}" ]; then
  echo "❌ Erro: Especifique o arquivo de backup para restaurar." >&2
  echo "Uso: ./restore-postgres.sh /var/backups/tembarber/db_backup_XXXXXX.sql.gz" >&2
  exit 1
fi

BACKUP_FILE="$1"

# ==========================================
# 1. VALIDAÇÃO PRÉVIA ESTRITA (ANTES DE QUALQUER AÇÃO NO BANCO)
# ==========================================
if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Erro: Arquivo não encontrado: $BACKUP_FILE" >&2
  exit 1
fi

if [ ! -s "$BACKUP_FILE" ]; then
  echo "❌ Erro: Arquivo de backup está vazio: $BACKUP_FILE" >&2
  exit 1
fi

echo "🔍 Validando integridade do arquivo de backup antes de tocar no banco..."

if [ -f "${BACKUP_FILE}.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
  BACKUP_DIR_PATH="$(dirname "$BACKUP_FILE")"
  SHA_FILE_NAME="$(basename "${BACKUP_FILE}.sha256")"
  if ! (cd "$BACKUP_DIR_PATH" && sha256sum -c "$SHA_FILE_NAME" >/dev/null 2>&1); then
    echo "❌ Erro: Falha na verificação de checksum SHA-256 (${BACKUP_FILE}.sha256). Restauração abortada." >&2
    exit 1
  fi
  echo "  ✔ Checksum SHA-256 verificado."
fi

if ! gzip -t "$BACKUP_FILE"; then
  echo "❌ Erro: O arquivo gzip está corrompido ($BACKUP_FILE). Restauração abortada antes de qualquer alteração no banco." >&2
  exit 1
fi
echo "  ✔ Integridade gzip verificada."

if ! gzip -dc "$BACKUP_FILE" | awk '
  /PostgreSQL database dump/ { header = 1 }
  /PostgreSQL database dump complete/ { footer = 1 }
  END { exit !(header && footer) }
'; then
  echo "❌ Erro: O dump SQL está incompleto ou inválido (marcadores PostgreSQL ausentes). Restauração abortada antes de qualquer alteração no banco." >&2
  exit 1
fi
echo "  ✔ Cabeçalho e rodapé de dump PostgreSQL verificados."

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q '^true$'; then
  echo "❌ Erro: Container '${DB_CONTAINER}' não está em execução." >&2
  exit 1
fi

if ! docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null; then
  echo "❌ Erro: Não foi possível conectar ao banco '${DB_NAME}' no container '${DB_CONTAINER}'." >&2
  exit 1
fi
echo "  ✔ Conectividade com o container '${DB_CONTAINER}' (${DB_NAME}) verificada."

if [ "$FORCE_RESTORE" != "true" ]; then
  echo "⚠️ ATENÇÃO: Isso irá SOBRESCREVER todos os dados atuais do banco '$DB_NAME' com o backup:"
  echo "Arquivo: $BACKUP_FILE"
  read -r -p "Tem certeza que deseja continuar? (digite 'SIM' para confirmar): " CONFIRM
  if [ "$CONFIRM" != "SIM" ]; then
    echo "Operação cancelada pelo usuário."
    exit 0
  fi
fi

# ==========================================
# 2. RESTAURAÇÃO TRANSACIONAL ATÔMICA
# ==========================================
# O DROP/CREATE SCHEMA e todo o conteúdo do dump são executados em UMA ÚNICA TRANSAÇÃO
# (--single-transaction) com parada imediata em qualquer erro (-v ON_ERROR_STOP=1).
# Se qualquer instrução SQL do dump falhar, o PostgreSQL faz ROLLBACK completo,
# preservando o schema e os dados anteriores intactos.
echo "[$(date -Iseconds)] Restaurando banco de dados em transação única (ON_ERROR_STOP=1 --single-transaction)..."

{
  echo "DROP SCHEMA IF EXISTS public CASCADE;"
  echo "CREATE SCHEMA public;"
  gzip -dc "$BACKUP_FILE"
} | docker exec -i "$DB_CONTAINER" psql \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  --single-transaction >/dev/null

echo "✅ Restauração concluída com sucesso e validada transacionalmente!"
