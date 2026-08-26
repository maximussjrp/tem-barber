# Billing Phase 2.2C Reconciliation Runbook

This runbook is for an approved production maintenance window. It is not executed by the application or migration.

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

## External backup

```sh
backup_dir=/opt/tem-barber/backups
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
ts=$(date -u +%Y%m%dT%H%M%SZ)
file="$backup_dir/tenant_subscriptions_pre_reconcile_${ts}.csv"

docker exec tem-barber-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "COPY (SELECT * FROM tenant_subscriptions WHERE id IN ('4149b82b-b396-4cdb-b316-28e596bad023','790d247b-7c32-4323-ac3c-705002131f54','cffe07c6-d6a1-43d6-8d39-81a9b5b13d97','187f5337-ced6-4098-8cb3-1c7d49553ff2','ffe24ea0-ca6d-40eb-822c-f71fb1858c73','5bb1098c-871f-4ef9-a247-4c1000286631') ORDER BY barbershop_id, created_at, id) TO STDOUT WITH CSV HEADER" > "$file"
chmod 600 "$file"
test "$(wc -l < "$file")" -eq 7
sha256sum "$file"
```

Verify the CSV has all six IDs before proceeding. Do not store this backup inside PostgreSQL.

## Assertions and transaction

Run the following as one transaction. Replace `:expected` values only if the preflight review explicitly approves a changed baseline.

```sql
BEGIN;

LOCK TABLE tenant_subscriptions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  total_barbershops integer;
  total_subscriptions integer;
  duplicate_groups integer;
  unexpected integer;
BEGIN
  SELECT count(*) INTO total_barbershops FROM barbershops;
  SELECT count(*) INTO total_subscriptions FROM tenant_subscriptions;
  SELECT count(*) INTO duplicate_groups
    FROM (SELECT barbershop_id FROM tenant_subscriptions GROUP BY barbershop_id HAVING count(*) > 1) d;
  SELECT count(*) INTO unexpected
    FROM tenant_subscriptions
    WHERE id NOT IN (
      '4149b82b-b396-4cdb-b316-28e596bad023','790d247b-7c32-4323-ac3c-705002131f54',
      'cffe07c6-d6a1-43d6-8d39-81a9b5b13d97','187f5337-ced6-4098-8cb3-1c7d49553ff2',
      'ffe24ea0-ca6d-40eb-822c-f71fb1858c73','5bb1098c-871f-4ef9-a247-4c1000286631'
    )
    AND barbershop_id IN (
      SELECT barbershop_id FROM tenant_subscriptions GROUP BY barbershop_id HAVING count(*) > 1
    );
  IF total_barbershops <> 11 OR total_subscriptions <> 14 OR duplicate_groups <> 3 OR unexpected <> 0 THEN
    RAISE EXCEPTION 'Preflight assertion failed';
  END IF;
END $$;

DELETE FROM tenant_subscriptions
WHERE id IN (
  '4149b82b-b396-4cdb-b316-28e596bad023',
  'cffe07c6-d6a1-43d6-8d39-81a9b5b13d97',
  'ffe24ea0-ca6d-40eb-822c-f71fb1858c73'
);

DO $$
DECLARE
  total_subscriptions integer;
  zero_groups integer;
  duplicate_groups integer;
  keep_count integer;
BEGIN
  SELECT count(*) INTO total_subscriptions FROM tenant_subscriptions;
  SELECT count(*) INTO zero_groups
    FROM barbershops b LEFT JOIN tenant_subscriptions t ON t.barbershop_id = b.id
    GROUP BY b.id HAVING count(t.id) = 0;
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

## Migration

Apply the generated migration `20260826180000_add_unique_tenant_subscription_barbershop` only after reconciliation. It contains no production-specific IDs and intentionally fails if duplicates remain.

```sh
npx prisma migrate deploy
```

Verify the unique index exists and subscription writes are gated before reopening traffic.

## Janela crítica sem gap

A alternativa segura sem janela entre limpeza e unicidade é uma janela curta com a aplicação parada. Prepare a nova imagem antes da janela, mas não a inicie até a migration ser verificada.

1. Construir e validar a nova imagem enquanto `tem-barber-app` continua atendendo.
2. Iniciar a manutenção e parar somente `tem-barber-app`; manter PostgreSQL e Caddy ativos.
3. Fazer o backup externo dos seis registros.
4. Adquirir o lock, executar as assertions e a reconciliação transacional.
5. Aplicar a migration de índice único antes de iniciar a nova app.
6. Verificar o índice, 11 barbearias, 11 assinaturas e zero duplicidades.
7. Iniciar a nova app e executar logs/HTTP/smoke.
8. Encerrar a janela somente após o smoke passar.

Não há alternativa segura de zero downtime sem bloquear writes de assinatura ou usar feature flag distribuída; parar a app remove a race por simplicidade.

## Abort e rollback

- Backup falhou: abortar antes de qualquer DELETE e manter a app parada somente até liberar a janela.
- Qualquer assertion falhou: executar `ROLLBACK` e não aplicar migration.
- DELETE afetou quantidade diferente de 3: abortar e executar `ROLLBACK`.
- DELETE foi commitado e a migration falhou: manter a app parada; restaurar os três registros removidos a partir do backup externo em uma nova transação somente após validar que o índice não existe.
- Se um índice único tiver sido criado parcialmente, removê-lo antes da restauração e abortar a janela.
- Se a nova app não subir: não reabrir tráfego; restaurar os registros somente se necessário para voltar ao estado anterior e investigar offline.
- Nunca restaurar duplicidades enquanto a app nova estiver aceitando writes.

A migration é atômica no PostgreSQL: ou o índice existe integralmente, ou não existe. Só iniciar a app após confirmar isso.
