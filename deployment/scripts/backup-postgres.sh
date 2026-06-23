#!/bin/bash

# Configuration
BACKUP_DIR="/var/backups/tem-barber"
DB_CONTAINER="tem-barber-postgres"
DB_USER="tem_barber_user"
DB_NAME="tem_barber"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${DB_NAME}_${TIMESTAMP}.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

echo "Starting database backup..."

# Perform pg_dump inside container and compress
docker exec -t "${DB_CONTAINER}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  echo "Backup successfully created: ${BACKUP_FILE}"
else
  echo "Backup failed!" >&2
  exit 1
fi

# Apply retention policy (delete old backups)
echo "Applying retention policy (deleting backups older than ${RETENTION_DAYS} days)..."
find "${BACKUP_DIR}" -type f -name "backup_${DB_NAME}_*.sql.gz" -mtime +"${RETENTION_DAYS}" -exec rm {} \;

echo "Backup process finished."
