#!/bin/bash

# Configuration
DB_CONTAINER="tem-barber-postgres"
DB_USER="tem_barber_user"
DB_NAME="tem_barber"

# Read file path
BACKUP_FILE=$1

# 1. Validate variables are not empty
if [ -z "${DB_CONTAINER}" ]; then
  echo "Error: DB_CONTAINER variable is empty!" >&2
  exit 1
fi

if [ -z "${DB_USER}" ]; then
  echo "Error: DB_USER variable is empty!" >&2
  exit 1
fi

if [ -z "${DB_NAME}" ]; then
  echo "Error: DB_NAME variable is empty!" >&2
  exit 1
fi

# 2. Validate backup file parameter
if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 /path/to/backup_file.sql.gz"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# 3. Validate database container is running and accessible
if ! docker ps --format '{{.Names}}' | grep -Eq "^${DB_CONTAINER}$"; then
  echo "Error: Database container '${DB_CONTAINER}' is not running or not accessible!" >&2
  exit 1
fi

# 4. Display clear configuration and destructive warning
echo "============================================="
echo "DATABASE RESTORE CONFIGURATION"
echo "============================================="
echo "DB Container:  ${DB_CONTAINER}"
echo "DB Name:       ${DB_NAME}"
echo "DB User:       ${DB_USER}"
echo "Backup File:   ${BACKUP_FILE}"
echo "============================================="
echo "WARNING: This will DESTROY and OVERWRITE all data in the database '${DB_NAME}'!"
echo "============================================="

# 5. Require strong explicit confirmation
read -p "Digite RESTORE TEM_BARBER para continuar: " CONFIRMATION
echo
if [ "${CONFIRMATION}" != "RESTORE TEM_BARBER" ]; then
  echo "Restore cancelled. Confirmation did not match."
  exit 1
fi

# 6. Execute Drop and Recreate Schema
echo "Dropping and recreating public schema inside '${DB_CONTAINER}'..."
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
if [ $? -ne 0 ]; then
  echo "Error: Failed to drop and recreate public schema!" >&2
  exit 1
fi

# 7. Execute Restore
echo "Restoring database from ${BACKUP_FILE}..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}"

if [ $? -eq 0 ]; then
  echo "Database successfully restored!"
else
  echo "Restore failed!" >&2
  exit 1
fi
