-- Release Operacional 1B: comissoes e extrato do profissional.
-- Rollback: em ambiente sem lancamentos reais, remover nesta ordem:
-- DROP TABLE "commission_adjustments";
-- DROP TABLE "commission_periods";
-- DROP TABLE "commission_entries";
-- DROP TABLE "commission_configs";
-- DROP TYPE "CommissionAdjustmentType";
-- DROP TYPE "CommissionPeriodStatus";
-- DROP TYPE "CommissionEntryStatus";
-- DROP TYPE "CommissionConfigType";

CREATE TYPE "CommissionConfigType" AS ENUM ('PERCENTAGE', 'FIXED_VALUE');
CREATE TYPE "CommissionEntryStatus" AS ENUM ('GENERATED', 'PARTIALLY_RELEASED', 'RELEASED', 'PAID', 'REVERSED');
CREATE TYPE "CommissionPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');
CREATE TYPE "CommissionAdjustmentType" AS ENUM ('RELEASE', 'REVERSAL', 'PAID_ADJUSTMENT');

CREATE TABLE "commission_configs" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "member_id" TEXT,
  "service_id" TEXT,
  "category_id" TEXT,
  "scope_key" TEXT NOT NULL,
  "type" "CommissionConfigType" NOT NULL,
  "value" DECIMAL(10,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_configs_value_check" CHECK (
    ("type" = 'PERCENTAGE' AND "value" >= 0 AND "value" <= 100)
    OR
    ("type" = 'FIXED_VALUE' AND "value" >= 0)
  )
);

CREATE TABLE "commission_entries" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "comanda_item_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "config_id" TEXT,
  "config_snapshot" JSONB NOT NULL,
  "base_amount" DECIMAL(10,2) NOT NULL,
  "generated_amount" DECIMAL(10,2) NOT NULL,
  "released_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "reversed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "competence" TEXT NOT NULL,
  "status" "CommissionEntryStatus" NOT NULL DEFAULT 'GENERATED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commission_periods" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "competence" TEXT NOT NULL,
  "status" "CommissionPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "generated_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "released_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "reversed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "balance_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "closed_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "closed_by_id" TEXT,
  "paid_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commission_adjustments" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "type" "CommissionAdjustmentType" NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "competence" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_configs_barbershop_id_scope_key_key" ON "commission_configs"("barbershop_id", "scope_key");
CREATE INDEX "commission_configs_barbershop_id_active_idx" ON "commission_configs"("barbershop_id", "active");
CREATE INDEX "commission_configs_member_id_idx" ON "commission_configs"("member_id");
CREATE INDEX "commission_configs_service_id_idx" ON "commission_configs"("service_id");
CREATE INDEX "commission_configs_category_id_idx" ON "commission_configs"("category_id");

CREATE UNIQUE INDEX "commission_entries_comanda_item_id_key" ON "commission_entries"("comanda_item_id");
CREATE INDEX "commission_entries_barbershop_id_competence_idx" ON "commission_entries"("barbershop_id", "competence");
CREATE INDEX "commission_entries_barbershop_id_status_idx" ON "commission_entries"("barbershop_id", "status");
CREATE INDEX "commission_entries_member_id_competence_idx" ON "commission_entries"("member_id", "competence");

CREATE UNIQUE INDEX "commission_periods_barbershop_id_member_id_competence_key" ON "commission_periods"("barbershop_id", "member_id", "competence");
CREATE INDEX "commission_periods_barbershop_id_competence_idx" ON "commission_periods"("barbershop_id", "competence");
CREATE INDEX "commission_periods_barbershop_id_status_idx" ON "commission_periods"("barbershop_id", "status");

CREATE INDEX "commission_adjustments_barbershop_id_competence_idx" ON "commission_adjustments"("barbershop_id", "competence");
CREATE INDEX "commission_adjustments_member_id_competence_idx" ON "commission_adjustments"("member_id", "competence");
CREATE INDEX "commission_adjustments_payment_id_idx" ON "commission_adjustments"("payment_id");

ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_comanda_item_id_fkey" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "commission_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "commission_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "command_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
