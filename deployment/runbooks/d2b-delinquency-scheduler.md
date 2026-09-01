# D2B delinquency scheduler production runbook

This runbook deploys only the time-driven invocation of the existing D2A tenant reconciler. It does not run migrations, replay webhooks, repair payments, mutate Asaas, or implement a generic subscription lifecycle.

The automatic timer must remain absent or disabled until both manual-run gates pass.

## A. Implementation validation

From the approved source commit, run the focused D2B and frozen billing suites, followed by:

```sh
npx prisma validate
npx prisma generate
npx tsc --noEmit
git diff --check
```

Do not proceed with a dirty or unreviewed source tree.

## B. Production preflight — read only

Verify hostname, source identity, clean worktree, current container IDs/restarts, disk space, app/Caddy health, and that no D2B timer or service is installed or enabled.

Verify host compatibility without changing it:

```sh
systemd --version
systemd-analyze calendar --iterations=3 '*-*-* *:05:00 America/Sao_Paulo'
curl --help all | grep -F -- '--fail-with-body'
```

The normalized calendar expression must remain `*-*-* *:05:00 America/Sao_Paulo`.

## C. Secure secret provisioning

Create exactly one canonical secret file. Do not print its value:

```sh
install -d -o root -g root -m 0700 /etc/tem-barber
umask 077
secret_value="$(openssl rand -hex 32)"
printf 'D2B_JOB_SECRET=%s\n' "$secret_value" > /etc/tem-barber/d2b-job-secret.env
unset secret_value
chown root:root /etc/tem-barber/d2b-job-secret.env
chmod 0600 /etc/tem-barber/d2b-job-secret.env
stat -c '%U:%G %a %n' /etc/tem-barber/d2b-job-secret.env
```

The same canonical secret file is consumed by Docker Compose interpolation and is loaded into the systemd service through `LoadCredential=`. The systemd service MUST NOT consume `D2B_JOB_SECRET` through `EnvironmentFile=` or `Environment=`. Do not copy the value into `/opt/tem-barber/deployment/.env`.

## D. Deploy the app while the timer is absent or disabled

Every future Compose command for this app must unset any inherited shell override and use both env files in this order:

```sh
env -u D2B_JOB_SECRET docker compose \
  -p deployment \
  --env-file /opt/tem-barber/deployment/.env \
  --env-file /etc/tem-barber/d2b-job-secret.env \
  -f /opt/tem-barber/deployment/docker-compose.yml \
  config -q

env -u D2B_JOB_SECRET docker compose \
  -p deployment \
  --env-file /opt/tem-barber/deployment/.env \
  --env-file /etc/tem-barber/d2b-job-secret.env \
  -f /opt/tem-barber/deployment/docker-compose.yml \
  build app

env -u D2B_JOB_SECRET docker compose \
  -p deployment \
  --env-file /opt/tem-barber/deployment/.env \
  --env-file /etc/tem-barber/d2b-job-secret.env \
  -f /opt/tem-barber/deployment/docker-compose.yml \
  up -d --no-deps app
```

Do not run `docker compose ... config` in a way that prints the resolved environment when the real production secret is loaded. `config -q` validates the Compose model without exposing `D2B_JOB_SECRET`. The timer must still be absent or disabled. Verify internal app and public Caddy health. Verify an unauthenticated `POST` returns the generic 401 response and causes zero database changes.

## E. Fresh SELECT-only dry run and pre-run database baseline

Re-run the approved D2A SELECT-only simulation against current production data. Do not invoke the reconciler. The historical expectation is:

- `ACTIVE -> ACTIVE`
- active debt count `0`
- `currentPeriodStart`: `2026-07-27T02:59:59.999Z` -> `2026-07-26T00:00:00.000Z`
- `lastPaymentAt`: `2026-07-26T02:59:59.999Z` -> `2026-07-25T00:00:00.000Z`
- status, plan, price, period end, grace end, payment method, and last access payment unchanged

If legitimate production data means the fresh simulation no longer predicts exactly this convergence, stop and obtain a new review. Do not force the historical expectation.

Capture the candidate `TenantSubscription` identity, its exact nine semantic fields, and `updated_at`:

```sql
SELECT id, barbershop_id, plan_id, status, plan_name, monthly_price,
       period_start, period_end, grace_period_ends_at, payment_method,
       last_payment_at, last_access_payment_id, updated_at
FROM tenant_subscriptions
WHERE barbershop_id IN (
  SELECT DISTINCT barbershop_id FROM asaas_billing_subscriptions
)
ORDER BY barbershop_id;
```

Use these exact D2A payment hashes without altering the formulas between snapshots:

```sql
SELECT md5(
  string_agg(
    concat(
      id, ':', asaas_payment_id, ':', status, ':', billing_type, ':',
      value::text, ':', COALESCE(due_date::text, ''), ':',
      COALESCE(payment_date::text, '')
    ),
    '|' ORDER BY created_at ASC
  )
)
FROM asaas_billing_payments;

SELECT md5(
  string_agg(
    concat(
      id, ':', COALESCE(first_positive_at::text, ''), ':',
      COALESCE(source_event_at::text, ''), ':', COALESCE(source_event_id, '')
    ),
    '|' ORDER BY created_at ASC
  )
)
FROM asaas_billing_payments;
```

Freeze these exact whole-row formulas for subscriptions and webhooks for every pre/post comparison in this rollout:

```sql
SELECT md5(COALESCE(
  string_agg(to_jsonb(s)::text, '|' ORDER BY created_at, id),
  ''
))
FROM asaas_billing_subscriptions s;

SELECT md5(COALESCE(
  string_agg(to_jsonb(w)::text, '|' ORDER BY created_at, id),
  ''
))
FROM asaas_webhook_events w;
```

Also capture webhook `TOTAL`, `PROCESSED`, `IGNORED`, `FAILED`, and `PENDING` counts. If webhook activity occurs during the gate, stop, classify it by timestamps, and establish a fresh baseline.

## F. First authorized manual POST

Use the repository trigger script directly. It reads the canonical root secret file, ignores any inherited process environment, and never exposes the value through curl argv or environment:

```sh
/bin/sh /opt/tem-barber/deployment/systemd/tem-barber-d2b-trigger.sh
```

Invoke it exactly once. A non-zero exit is a failed gate.

## G. Exact first-run database after-proof

Repeat every baseline query from section E with exactly the same formulas. Require:

- Only `currentPeriodStart` and `lastPaymentAt` changed as freshly predicted.
- `updated_at` changed as metadata for that tenant update.
- Status, plan identity/name, monthly price, period end, grace end, payment method, and last access payment are unchanged.
- Payment canonical and watermark hashes are unchanged.
- Asaas subscription hash is unchanged.
- Webhook counts and hash are unchanged.

Any unexpected field change is a stop condition. Keep the timer disabled.

## H. Second authorized manual POST

Run the same authorized trigger exactly once more. Require HTTP 200 / curl exit zero, `reconciledCount = 0`, and the current candidate classified as `noChange` / `IDEMPOTENT_NO_CHANGE`.

## I. Second-run zero-write proof

Repeat every baseline query from section E with exactly the same formulas. Require:

- Exact tenant semantic state unchanged.
- `TenantSubscription.updated_at` unchanged.
- Payment hashes unchanged.
- Asaas subscription hash unchanged.
- Webhook counts and hash unchanged.

The timer must not be installed or enabled unless this gate passes.

## J. Install the trigger, service, and timer

Only after both manual gates pass:

```sh
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 \
  /opt/tem-barber/deployment/systemd/tem-barber-d2b-trigger.sh \
  /usr/local/libexec/tem-barber-d2b-trigger
install -o root -g root -m 0644 \
  /opt/tem-barber/deployment/systemd/tem-barber-d2b.service \
  /etc/systemd/system/tem-barber-d2b.service
install -o root -g root -m 0644 \
  /opt/tem-barber/deployment/systemd/tem-barber-d2b.timer \
  /etc/systemd/system/tem-barber-d2b.timer
```

## K. Validate timer expression

```sh
systemd-analyze calendar --iterations=3 '*-*-* *:05:00 America/Sao_Paulo'
```

`Persistent=true` catches an activation missed while the timer was inactive. It does not retry a service execution that ran and failed. A failed run is attempted again only at the next ordinary hourly `:05` activation.

## L. Load units

```sh
systemctl daemon-reload
systemctl cat tem-barber-d2b.service
systemctl cat tem-barber-d2b.timer
```

`systemctl cat tem-barber-d2b.service` must contain:

```text
LoadCredential=d2b-job-secret.env:/etc/tem-barber/d2b-job-secret.env
```

and must not contain:

```text
EnvironmentFile=/etc/tem-barber/d2b-job-secret.env
Environment=D2B_JOB_SECRET=...
```

Do not print or inspect the secret value.

## M. Enable/start the timer only

```sh
systemctl enable --now tem-barber-d2b.timer
```

Do not start a second manual service invocation during an active run.

## N. Observe the first automatic execution

```sh
systemctl status tem-barber-d2b.timer --no-pager
systemctl status tem-barber-d2b.service --no-pager
journalctl -u tem-barber-d2b.service --since '2 hours ago' --no-pager
docker logs --since 2h tem-barber-app
```

Require a successful oneshot exit and a structured completion log with consistent aggregate counts. An HTTP status of 400 or higher makes curl and the service fail. There are no curl retries.

## O. Final closure

Record source commit, app image/container, timer next elapse, service result, application health, aggregate job result, and unchanged payment/subscription/webhook proofs. Confirm no migration, Caddy change, Asaas mutation, or webhook replay occurred.

## P. Rollback

1. Disable and stop only `tem-barber-d2b.timer`.
2. Do not run the reconciler during rollback.
3. Roll the app back using the approved prior image/source and both env files.
4. If Compose wiring is rolled back, restore the matching Compose file before app recreation.
5. Remove or restore only the D2B trigger/service/timer artifacts, then run `systemctl daemon-reload`.
6. Retain the canonical secret file until rollback review decides secure removal or rotation.
7. Verify app/Caddy health and database state.

Do not restart Postgres or Caddy, run a full-stack `up`, prune Docker, replay webhooks, or mutate Asaas.
