# Billing Phase 2.2D1 Plan Code Backfill

This runbook is preparatory. Do not execute it until the expand migration has
been applied in production and the maintenance operation has been explicitly
approved.

The expand migration only adds nullable `plans.code` and its unique index. It
does not backfill data. The current application remains compatible because it
does not read or write this column.

## Expected production baseline

- Total plans: `1`
- Plan ID: `d4e9563f-fe5f-42ee-8577-d9c6136a6828`
- Name: `Plano Tem Barber`
- Price: `49.90`
- Period: `MONTHLY`
- Max members: `3`
- Active: `true`
- Tenant subscriptions referencing the plan: `11`
- Orphan tenant subscription plan references: `0`
- Current code: `NULL`
- Plans already using `pro_monthly`: `0`

Abort without running the transaction if the expand migration or the
`plans_code_key` unique index is absent or invalid.

## Production context

Run from `/opt/tem-barber` using the explicit production Compose configuration.
These commands must not print database credentials.

```sh
set -euo pipefail
cd /opt/tem-barber
compose=(docker compose -p deployment -f deployment/docker-compose.yml --env-file deployment/.env)
"${compose[@]}" config --quiet
```

Optional read-only connectivity check:

```sh
"${compose[@]}" exec -T postgres sh -lc \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT 1"' \
  | grep -qx 1
```

## Guarded backfill transaction

The transaction locks `plans` against competing catalog writes and
`tenant_subscriptions` against concurrent changes while it records and verifies
a fingerprint of every tenant subscription. The only persistent row mutation
is the single guarded update to `plans.code`.

```sql
BEGIN;

LOCK TABLE plans IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE tenant_subscriptions IN SHARE MODE;

DO $$
DECLARE
  total_plans integer;
  target_id_count integer;
  target_expected_count integer;
  target_subscription_count integer;
  orphan_subscription_count integer;
  pro_monthly_count integer;
  valid_unique_index_count integer;
  tenant_fingerprint text;
BEGIN
  SELECT count(*) INTO total_plans FROM plans;

  SELECT count(*) INTO target_id_count
  FROM plans
  WHERE id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828';

  SELECT count(*) INTO target_expected_count
  FROM plans
  WHERE id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828'
    AND name = 'Plano Tem Barber'
    AND price = 49.90
    AND period::text = 'MONTHLY'
    AND max_members = 3
    AND is_active IS TRUE
    AND code IS NULL;

  SELECT count(*) INTO target_subscription_count
  FROM tenant_subscriptions
  WHERE plan_id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828';

  SELECT count(*) INTO orphan_subscription_count
  FROM tenant_subscriptions t
  LEFT JOIN plans p ON p.id = t.plan_id
  WHERE p.id IS NULL;

  SELECT count(*) INTO pro_monthly_count
  FROM plans
  WHERE code = 'pro_monthly';

  SELECT count(*) INTO valid_unique_index_count
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = 'public'
    AND tbl.relname = 'plans'
    AND idx.relname = 'plans_code_key'
    AND i.indisunique
    AND i.indisvalid
    AND i.indisready;

  SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '|' ORDER BY t.id), ''))
  INTO tenant_fingerprint
  FROM tenant_subscriptions t;

  PERFORM set_config(
    'tem_barber.plan_code_backfill_tenant_fingerprint',
    tenant_fingerprint,
    true
  );

  IF total_plans <> 1
    OR target_id_count <> 1
    OR target_expected_count <> 1
    OR target_subscription_count <> 11
    OR orphan_subscription_count <> 0
    OR pro_monthly_count <> 0
    OR valid_unique_index_count <> 1
  THEN
    RAISE EXCEPTION 'Plan code pre-update assertions failed';
  END IF;
END $$;

DO $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE plans
  SET code = 'pro_monthly'
  WHERE id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828'
    AND name = 'Plano Tem Barber'
    AND price = 49.90
    AND period::text = 'MONTHLY'
    AND max_members = 3
    AND is_active IS TRUE
    AND code IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Expected to backfill exactly one Plan, got %', updated_count;
  END IF;
END $$;

DO $$
DECLARE
  total_plans integer;
  pro_monthly_count integer;
  null_code_count integer;
  target_expected_count integer;
  target_subscription_count integer;
  orphan_subscription_count integer;
  before_tenant_fingerprint text;
  after_tenant_fingerprint text;
BEGIN
  SELECT count(*) INTO total_plans FROM plans;
  SELECT count(*) INTO pro_monthly_count FROM plans WHERE code = 'pro_monthly';
  SELECT count(*) INTO null_code_count FROM plans WHERE code IS NULL;

  SELECT count(*) INTO target_expected_count
  FROM plans
  WHERE id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828'
    AND code = 'pro_monthly'
    AND name = 'Plano Tem Barber'
    AND price = 49.90
    AND period::text = 'MONTHLY'
    AND max_members = 3
    AND is_active IS TRUE;

  SELECT count(*) INTO target_subscription_count
  FROM tenant_subscriptions
  WHERE plan_id = 'd4e9563f-fe5f-42ee-8577-d9c6136a6828';

  SELECT count(*) INTO orphan_subscription_count
  FROM tenant_subscriptions t
  LEFT JOIN plans p ON p.id = t.plan_id
  WHERE p.id IS NULL;

  before_tenant_fingerprint := current_setting(
    'tem_barber.plan_code_backfill_tenant_fingerprint'
  );

  SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '|' ORDER BY t.id), ''))
  INTO after_tenant_fingerprint
  FROM tenant_subscriptions t;

  IF total_plans <> 1
    OR pro_monthly_count <> 1
    OR null_code_count <> 0
    OR target_expected_count <> 1
    OR target_subscription_count <> 11
    OR orphan_subscription_count <> 0
    OR before_tenant_fingerprint IS DISTINCT FROM after_tenant_fingerprint
  THEN
    RAISE EXCEPTION 'Plan code post-update assertions failed';
  END IF;
END $$;

COMMIT;
```

Any exception aborts the script when it is run with `psql -v ON_ERROR_STOP=1`.
The PostgreSQL connection must be allowed to close so the open transaction is
rolled back. Do not retry after changing expected values without a new human
review.

## Post-commit read-only verification

Confirm independently:

- Total plans: `1`
- Target plan code: `pro_monthly`
- Plans with `NULL` code: `0`
- `plans_code_key` exists, is ready, valid, and unique
- Target plan attributes remain unchanged
- Target tenant subscription count: `11`
- Orphan plan references: `0`
- No `tenant_subscriptions` row changed

This runbook does not change `TenantSubscription.planName` or
`TenantSubscription.monthlyPrice`. They remain commercial snapshots.
