-- This migration intentionally fails if duplicate TenantSubscription rows remain.
-- Reconcile production data before applying it.
CREATE UNIQUE INDEX "tenant_subscriptions_barbershop_id_key"
ON "tenant_subscriptions"("barbershop_id");
