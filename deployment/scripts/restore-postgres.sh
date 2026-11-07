#!/usr/bin/env bash
# ==========================================
# TEM BARBER - SCRIPT DE RESTAURAÇÃO POSTGRESQL
# ==========================================
# Uso: ./restore-postgres.sh /caminho/para/db_backup_YYYYMMDD_HHMMSS.sql.gz
# Alinhado com deployment/docker-compose.yml:
#   Container padrão: tem-barber-postgres
#   Usuário/Banco padrão: lidos de POSTGRES_USER / POSTGRES_DB do container
#                         (fallback: tem_barber_user / tem_barber)
# Variáveis opcionais de ambiente:
#   DB_CONTAINER          (padrão: tem-barber-postgres)
#   DB_USER               (opcional: sobrescreve POSTGRES_USER do container)
#   DB_NAME               (opcional: sobrescreve POSTGRES_DB do container)
#   ALLOW_MISSING_SHA256  (padrão: false; exige arquivo .sha256 por padrão)
#   FORCE_RESTORE         (padrão: false; bloqueado em containers/bancos de produção)

set -Eeuo pipefail

DB_CONTAINER="${DB_CONTAINER:-tem-barber-postgres}"
ALLOW_MISSING_SHA256="${ALLOW_MISSING_SHA256:-false}"
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

if [ -f "${BACKUP_FILE}.sha256" ]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    echo "❌ Erro: sha256sum não disponível para validar ${BACKUP_FILE}.sha256." >&2
    exit 1
  fi
  BACKUP_DIR_PATH="$(dirname "$BACKUP_FILE")"
  SHA_FILE_NAME="$(basename "${BACKUP_FILE}.sha256")"
  if ! (cd "$BACKUP_DIR_PATH" && sha256sum -c "$SHA_FILE_NAME" >/dev/null 2>&1); then
    echo "❌ Erro: Falha na verificação de checksum SHA-256 (${BACKUP_FILE}.sha256). Restauração abortada." >&2
    exit 1
  fi
  echo "  ✔ Checksum SHA-256 verificado."
elif [ "$ALLOW_MISSING_SHA256" = "true" ]; then
  echo "  ⚠️ Aviso: Arquivo ${BACKUP_FILE}.sha256 ausente (prosseguindo por ALLOW_MISSING_SHA256=true)."
else
  echo "❌ Erro: Arquivo de checksum ${BACKUP_FILE}.sha256 não encontrado (defina ALLOW_MISSING_SHA256=true apenas para backups legados verificados manualmente)." >&2
  exit 1
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

# Resolver DB_USER e DB_NAME a partir do container caso não tenham sido fornecidos
if [ -z "${DB_USER:-}" ]; then
  DB_USER="$(docker exec -i "$DB_CONTAINER" sh -c 'printf "%s" "${POSTGRES_USER:-tem_barber_user}"')"
fi
if [ -z "${DB_NAME:-}" ]; then
  DB_NAME="$(docker exec -i "$DB_CONTAINER" sh -c 'printf "%s" "${POSTGRES_DB:-tem_barber}"')"
fi

if ! docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null; then
  echo "❌ Erro: Não foi possível conectar ao banco '${DB_NAME}' no container '${DB_CONTAINER}' com o usuário '${DB_USER}'." >&2
  exit 1
fi
echo "  ✔ Conectividade com o container '${DB_CONTAINER}' (banco '${DB_NAME}', usuário '${DB_USER}') verificada."

# Trava de segurança: impedir que testes automatizados (FORCE_RESTORE=true) atinjam containers ou bancos de produção
if [ "$FORCE_RESTORE" = "true" ]; then
  case "$DB_CONTAINER" in
    tem-barber-postgres|tembarber-postgres)
      echo "❌ BLOQUEIO DE SEGURANÇA: FORCE_RESTORE=true é proibido no container de produção '${DB_CONTAINER}'." >&2
      exit 1
      ;;
  esac
  case "$DB_NAME" in
    tem_barber|tembarber_prod)
      echo "❌ BLOQUEIO DE SEGURANÇA: FORCE_RESTORE=true é proibido no banco de produção '${DB_NAME}'." >&2
      exit 1
      ;;
  esac
  case "$DB_NAME" in
    *test*|*drill*)
      ;;
    *)
      echo "❌ BLOQUEIO DE SEGURANÇA: FORCE_RESTORE=true exige banco explicitamente identificado como '*test*' ou '*drill*' (atual: '${DB_NAME}')." >&2
      exit 1
      ;;
  esac
else
  echo "⚠️ ATENÇÃO: Isso irá SOBRESCREVER todos os dados atuais do banco '$DB_NAME' (container '$DB_CONTAINER') com o backup:"
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
