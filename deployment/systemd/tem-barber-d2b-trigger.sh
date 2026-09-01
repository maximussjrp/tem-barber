#!/bin/sh
set -eu

unset D2B_JOB_SECRET

credential_file="/etc/tem-barber/d2b-job-secret.env"
if [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "${CREDENTIALS_DIRECTORY}/d2b-job-secret.env" ]; then
  credential_file="${CREDENTIALS_DIRECTORY}/d2b-job-secret.env"
fi

if [ ! -r "$credential_file" ]; then
  exit 1
fi

secret=""
match_count=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    D2B_JOB_SECRET=*)
      match_count=$((match_count + 1))
      value=${line#D2B_JOB_SECRET=}
      if [ "$match_count" -gt 1 ]; then
        exit 1
      fi
      secret="$value"
      ;;
  esac
done < "$credential_file"

if [ "$match_count" -ne 1 ] || [ -z "$secret" ]; then
  exit 1
fi

case "$secret" in
  "")
    exit 1
    ;;
  *)
    if [ "${#secret}" -ne 64 ] || ! printf '%s' "$secret" | grep -Eq '^[0-9A-Fa-f]{64}$'; then
      exit 1
    fi
    ;;
esac

printf 'header = "Authorization: Bearer %s"\n' "$secret" |
  env -u D2B_JOB_SECRET curl \
    --config - \
    --fail-with-body \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 600 \
    --request POST \
    --resolve app.tembarber.com.br:443:127.0.0.1 \
    https://app.tembarber.com.br/api/internal/billing/reconcile-delinquency
