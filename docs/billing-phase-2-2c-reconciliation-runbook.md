# Billing Phase 2.2C Reconciliation Runbook

This runbook is preparatory. It is not executed automatically by the application, migration, or deployment process.

Use only during an approved production maintenance window. Production writes are intentionally limited to the explicit reconciliation transaction below.

## Preconditions

Use a database backup and an external protected directory such as `/opt/tem-barber/backups/`. Stop or gate subscription writes before the transaction. Abort if any assertion fails.

Expected state before deletion:

- 11 barbershops
- 14 TenantSubscription rows
- exactly 3 duplicate barbershops
- no dependent foreign keys to `tenant_subscriptions.id`

Expected duplicate pairs:

- Barba Negra: keep `790d247b-7c32-4323-ac3c-705002131f54`, remove `4149b82b-b396-4cdb-b316-28e596bad023`
- Barbearia cazaroti: keep `187f5337-ced6-4098-8cb3-1c7d49553ff2`, remove `cffe07c6-d6a1-43d6-8d39-81a9b5b13d97`
- Zovisk Cortes: keep `5bb1098c-871f-4ef9-a247-4c1000286631`, remove `ffe24ea0-ca6d-40eb-822c-f71fb1858c73`

## Production context

Run commands from `/opt/tem-barber` with the production project file and env file explicitly selected:

```sh
set -euo pipefail
cd /opt/tem-barber
compose=(docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env)
"${compose[@]}" config --quiet
```

The PostgreSQL container receives `POSTGRES_USER`, `POSTGRES_DB`, and `POSTGRES_PASSWORD` from `deployment/.env`; the app receives a container-network `DATABASE_URL` targeting `postgres:5432`. Do not print those values.

Validate connectivity without writing:

```sh
set -euo pipefail
compose=(docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env)
"${compose[@]}" exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT 1"' | grep -qx 1
```

The exact production migration command is documented below and must be run only after reconciliation. It uses the production Compose project, env file, app image, and app network/database environment. Do not execute it during preparation.

## External backup

```sh
set -euo pipefail
backup_dir=/opt/tem-barber/backups
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
ts=$(date -u +%Y%m%dT%H%M%SZ)
file="$backup_dir/tenant_subscriptions_pre_reconcile_${ts}.csv"

docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "COPY (SELECT * FROM tenant_subscriptions WHERE id IN ('"'"'4149b82b-b396-4cdb-b316-28e596bad023'"'"','"'"'790d247b-7c32-4323-ac3c-705002131f54'"'"','"'"'cffe07c6-d6a1-43d6-8d39-81a9b5b13d97'"'"','"'"'187f5337-ced6-4098-8cb3-1c7d49553ff2'"'"','"'"'ffe24ea0-ca6d-40eb-822c-f71fb1858c73'"'"','"'"'5bb1098c-871f-4ef9-a247-4c1000286631'"'"') ORDER BY barbershop_id, created_at, id) TO STDOUT WITH CSV HEADER"' > "$file"
chmod 600 "$file"
test "$(wc -l < "$file")" -eq 7
for id in 4149b82b-b396-4cdb-b316-28e596bad023 790d247b-7c32-4323-ac3c-705002131f54 cffe07c6-d6a1-43d6-8d39-81a9b5b13d97 187f5337-ced6-4098-8cb3-1c7d49553ff2 ffe24ea0-ca6d-40eb-822c-f71fb1858c73 5bb1098c-871f-4ef9-a247-4c1000286631; do
  grep -q "$id" "$file"
done
sha256sum "$file"
```

Run the following as one transaction. Replace `:expected` values only if the preflight review explicitly approves a changed baseline.

```sql
BEGIN;
LOCK TABLE tenant_subscriptions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  total_barbershops integer;
  total_subscriptions integer;
  duplicate_groups integer;
  approved_six integer;
  keep_count integer;
  remove_count integer;
  pair_mismatch integer;
BEGIN
  SELECT count(*) INTO total_barbershops FROM barbershops;
  SELECT count(*) INTO total_subscriptions FROM tenant_subscriptions;
  SELECT count(*) INTO duplicate_groups
    FROM (SELECT barbershop_id FROM tenant_subscriptions GROUP BY barbershop_id HAVING count(*) > 1) d;
  SELECT count(*) INTO approved_six FROM tenant_subscriptions WHERE id IN ('4149b82b-b396-4cdb-b316-28e596bad023','790d247b-7c32-4323-ac3c-705002131f54','cffe07c6-d6a1-43d6-8d39-81a9b5b13d97','187f5337-ced6-4098-8cb3-1c7d49553ff2','ffe24ea0-ca6d-40eb-822c-f71fb1858c73','5bb1098c-871f-4ef9-a247-4c1000286631');
  SELECT count(*) INTO keep_count FROM tenant_subscriptions WHERE id IN ('790d247b-7c32-4323-ac3c-705002131f54','187f5337-ced6-4098-8cb3-1c7d49553ff2','5bb1098c-871f-4ef9-a247-4c1000286631');
  SELECT count(*) INTO remove_count FROM tenant_subscriptions WHERE id IN ('4149b82b-b396-4cdb-b316-28e596bad023','cffe07c6-d6a1-43d6-8d39-81a9b5b13d97','ffe24ea0-ca6d-40eb-822c-f71fb1858c73');
  SELECT count(*) INTO pair_mismatch FROM (VALUES
    ('790d247b-7c32-4323-ac3c-705002131f54','4149b82b-b396-4cdb-b316-28e596bad023'),
    ('187f5337-ced6-4098-8cb3-1c7d49553ff2','cffe07c6-d6a1-43d6-8d39-81a9b5b13d97'),
    ('5bb1098c-871f-4ef9-a247-4c1000286631','ffe24ea0-ca6d-40eb-822c-f71fb1858c73')
  ) pairs(keep_id,remove_id)
  WHERE (SELECT barbershop_id FROM tenant_subscriptions WHERE id=pairs.keep_id) IS DISTINCT FROM (SELECT barbershop_id FROM tenant_subscriptions WHERE id=pairs.remove_id);
  IF total_barbershops <> 11 OR total_subscriptions <> 14 OR duplicate_groups <> 3 OR approved_six <> 6 OR keep_count <> 3 OR remove_count <> 3 OR pair_mismatch <> 0 THEN
    RAISE EXCEPTION 'Preflight assertion failed';
  END IF;
END $$;

DO $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM tenant_subscriptions
  WHERE id IN (
    '4149b82b-b396-4cdb-b316-28e596bad023',
    'cffe07c6-d6a1-43d6-8d39-81a9b5b13d97',
    'ffe24ea0-ca6d-40eb-822c-f71fb1858c73'
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 3 THEN
    RAISE EXCEPTION 'Expected to delete exactly 3 rows, got %', deleted_count;
  END IF;
END $$;

DO $$
DECLARE
  total_subscriptions integer;
  zero_groups integer;
  duplicate_groups integer;
  keep_count integer;
BEGIN
  SELECT count(*) INTO total_subscriptions FROM tenant_subscriptions;
  SELECT count(*) INTO zero_groups FROM barbershops b
    WHERE NOT EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.barbershop_id = b.id);
  SELECT count(*) INTO duplicate_groups
    FROM (SELECT barbershop_id FROM tenant_subscriptions GROUP BY barbershop_id HAVING count(*) > 1) d;
  SELECT count(*) INTO keep_count FROM tenant_subscriptions WHERE id IN (
    '790d247b-7c32-4323-ac3c-705002131f54',
    '187f5337-ced6-4098-8cb3-1c7d49553ff2',
    '5bb1098c-871f-4ef9-a247-4c1000286631'
  );
  IF total_subscriptions <> 11 OR zero_groups <> 0 OR duplicate_groups <> 0 OR keep_count <> 3 THEN
    RAISE EXCEPTION 'Post-delete assertion failed';
  END IF;
END $$;

COMMIT;
```

If any assertion raises, PostgreSQL rolls back the transaction. Only after verifying the committed counts should the uniqueness migration be applied in the same operational window.

## Preservação da imagem e janela de manutenção

Antes de parar a aplicação, capture e preserve a imagem antiga com uma tag imutável. Faça o build da nova imagem enquanto a app antiga atende.

```sh
set -euo pipefail
cd /opt/tem-barber
compose=(docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env)
app_id=$(docker inspect --format '{{.Id}}' tem-barber-app)
old_image_id=$(docker inspect --format '{{.Image}}' tem-barber-app)
ts=$(date -u +%Y%m%dT%H%M%SZ)
test -n "$app_id" && test -n "$old_image_id"
docker tag "$old_image_id" "tem-barber-app-pre-44969d7-${ts}"
printf '%s\n' "$app_id" > "/opt/tem-barber/app_pre_rollback_${ts}.id"
printf '%s\n' "$old_image_id" > "/opt/tem-barber/app_pre_rollback_${ts}.image"
chmod 600 "/opt/tem-barber/app_pre_rollback_${ts}.id" "/opt/tem-barber/app_pre_rollback_${ts}.image"
```

Build the new image before opening the maintenance window, then capture its immutable image ID:

```sh
set -euo pipefail
"${compose[@]}" build app
new_image_id=$(docker image inspect --format '{{.Id}}' deployment-app:latest)
test -n "$new_image_id"
printf '%s\n' "$new_image_id" > "/opt/tem-barber/app_new_${ts}.image"
chmod 600 "/opt/tem-barber/app_new_${ts}.image"
```

Na janela crítica, pare somente a app. PostgreSQL e Caddy permanecem ativos:

```sh
set -euo pipefail
"${compose[@]}" stop app
```

Após backup, reconciliação, migration e assertions finais:

```sh
set -euo pipefail
"${compose[@]}" up -d --no-deps app
app_after_image_id=$(docker inspect --format '{{.Image}}' tem-barber-app)
test "$app_after_image_id" = "$new_image_id"
docker logs --tail 100 tem-barber-app
```

Não há alternativa segura de zero downtime sem bloquear writes de assinatura ou usar coordenação distribuída. A parada da app elimina a race entre cleanup e índice único.

## Rollback operacional

- Antes do commit SQL: qualquer assertion falha, execute `ROLLBACK`; o banco permanece original e a app antiga pode ser iniciada novamente.
- Cleanup commitado e migration falha: mantenha a app parada; confirme que o índice não existe. Só restaure os três registros do backup em nova transação após revisar a causa e confirmar que não há unique index.
- Unique aplicada e app nova falha: não restaure duplicidades. Mantenha 11 assinaturas e a unique ativa e faça rollback apenas da aplicação para a imagem preservada.
- Backup falhou, DELETE afetou quantidade diferente de 3 ou assertion pós-delete falhou: abortar imediatamente e não aplicar migration.
- Não usar `prisma migrate resolve` no caminho feliz. Se uma migration for registrada como failed, inspecione `_prisma_migrations` e o índice; use `prisma migrate resolve --rolled-back 20260826180000_add_unique_tenant_subscription_barbershop` somente quando a migration estiver failed e o índice não existir.

## Migração em produção

Depois da reconciliação, execute a migration pelo ambiente explícito de produção, sem depender do shell do host:

```sh
set -euo pipefail
cd /opt/tem-barber
docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env run --rm --no-deps app npx prisma migrate deploy
```

Nunca marque a migration como aplicada se `tenant_subscriptions_barbershop_id_key` não existir.

Antes de iniciar a nova app, confirme:

```sh
set -euo pipefail
docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM tenant_subscriptions; SELECT count(*) FROM pg_indexes WHERE tablename = '\''tenant_subscriptions'\'' AND indexname = '\''tenant_subscriptions_barbershop_id_key'\''"'
```

Os resultados esperados são `11` e `1`, além de `11` barbearias, zero grupos duplicados, zero barbearias sem assinatura, KEEP presentes = `3`, REMOVE presentes = `0`, e a migration `20260826180000_add_unique_tenant_subscription_barbershop` registrada como aplicada. Só então inicie `app` e faça HOME/LOGIN/REGISTER e smoke funcional.
