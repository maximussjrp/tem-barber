-- AlterEnum
ALTER TYPE "FinancialEntryType" ADD VALUE IF NOT EXISTS 'COMMISSION_ADVANCE';
ALTER TYPE "FinancialEntryType" ADD VALUE IF NOT EXISTS 'COMMISSION_ADVANCE_REVERSAL';
ALTER TYPE "FinancialEntryType" ADD VALUE IF NOT EXISTS 'COMMISSION_PAYOUT';

-- CreateEnum
CREATE TYPE "CommissionCycleStatus" AS ENUM ('OPEN', 'PAID');

-- CreateEnum
CREATE TYPE "CommissionPayableType" AS ENUM ('RELEASE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CommissionPayableSourceKind" AS ENUM ('PAYMENT', 'REFUND', 'ITEM_COMPLETION', 'COMANDA_RECALCULATION', 'EXECUTOR_CORRECTION', 'LEGACY_BACKFILL');

-- CreateEnum
CREATE TYPE "CommissionDisbursementMethod" AS ENUM ('PIX', 'CASH', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionCycleAdjustmentType" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable
ALTER TABLE "comandas" ADD COLUMN "commission_revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "commission_entries" ADD COLUMN "attribution_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "supersedes_entry_id" TEXT;

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN "commission_advance_id" TEXT,
ADD COLUMN "commission_advance_reversal_id" TEXT,
ADD COLUMN "commission_payout_id" TEXT;

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN "commission_advance_id" TEXT,
ADD COLUMN "commission_advance_reversal_id" TEXT,
ADD COLUMN "commission_payout_id" TEXT;

-- CreateTable
CREATE TABLE "commission_cycles" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" "CommissionCycleStatus" NOT NULL DEFAULT 'OPEN',
    "gross_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "adjustments_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "advances_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "final_payout_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remaining_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payable_items" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "source_kind" "CommissionPayableSourceKind" NOT NULL,
    "source_payment_id" TEXT,
    "source_comanda_id" TEXT,
    "source_revision" INTEGER,
    "legacy_entry_id" TEXT,
    "reverses_payable_item_id" TEXT,
    "type" "CommissionPayableType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "is_historical_correction" BOOLEAN NOT NULL DEFAULT false,
    "event_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_advances" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "CommissionDisbursementMethod" NOT NULL,
    "disbursed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_advance_reversals" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "advance_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "return_method" "CommissionDisbursementMethod" NOT NULL,
    "is_physical_cash_returned" BOOLEAN NOT NULL DEFAULT false,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_advance_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payouts" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "CommissionDisbursementMethod",
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_cycle_adjustments" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "source_payable_item_id" TEXT,
    "source_advance_reversal_id" TEXT,
    "source_adjustment_id" TEXT,
    "source_cycle_id" TEXT,
    "source_entry_id" TEXT,
    "type" "CommissionCycleAdjustmentType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "payload_fingerprint" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_cycle_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_executor_correction_audits" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "comanda_item_id" TEXT NOT NULL,
    "old_entry_id" TEXT NOT NULL,
    "new_entry_id" TEXT NOT NULL,
    "old_member_id" TEXT NOT NULL,
    "new_member_id" TEXT NOT NULL,
    "old_config_snapshot" JSONB NOT NULL,
    "new_config_snapshot" JSONB NOT NULL,
    "old_released_amount" DECIMAL(10,2) NOT NULL,
    "new_released_amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_fingerprint" TEXT NOT NULL,
    "corrected_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_executor_correction_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_advance_audits" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "advance_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_advance_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_entries_supersedes_entry_id_key" ON "commission_entries"("supersedes_entry_id");
CREATE UNIQUE INDEX "commission_entries_comanda_item_id_attribution_version_key" ON "commission_entries"("comanda_item_id", "attribution_version");
CREATE INDEX "commission_entries_comanda_item_id_is_current_idx" ON "commission_entries"("comanda_item_id", "is_current");
CREATE INDEX "commission_entries_barbershop_id_member_id_status_idx" ON "commission_entries"("barbershop_id", "member_id", "status");

-- Partial Unique Index on commission_entries for single current entry per item
CREATE UNIQUE INDEX "commission_entries_one_current_per_comanda_item_uidx" ON "commission_entries"("comanda_item_id") WHERE "is_current" = true;

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_commission_advance_id_key" ON "cash_movements"("commission_advance_id");
CREATE UNIQUE INDEX "cash_movements_commission_advance_reversal_id_key" ON "cash_movements"("commission_advance_reversal_id");
CREATE UNIQUE INDEX "cash_movements_commission_payout_id_key" ON "cash_movements"("commission_payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_commission_advance_id_key" ON "financial_entries"("commission_advance_id");
CREATE UNIQUE INDEX "financial_entries_commission_advance_reversal_id_key" ON "financial_entries"("commission_advance_reversal_id");
CREATE UNIQUE INDEX "financial_entries_commission_payout_id_key" ON "financial_entries"("commission_payout_id");

-- CreateIndex: commission_cycles
CREATE UNIQUE INDEX "commission_cycles_barbershop_id_member_id_cycle_number_key" ON "commission_cycles"("barbershop_id", "member_id", "cycle_number");
CREATE INDEX "commission_cycles_barbershop_id_member_id_status_idx" ON "commission_cycles"("barbershop_id", "member_id", "status");
CREATE INDEX "commission_cycles_barbershop_id_status_idx" ON "commission_cycles"("barbershop_id", "status");

-- Partial Unique Index: at most one OPEN cycle per member in a barbershop
CREATE UNIQUE INDEX "commission_cycles_one_open_per_member_uidx" ON "commission_cycles"("barbershop_id", "member_id") WHERE "status" = 'OPEN';

-- CreateIndex: commission_payable_items
CREATE UNIQUE INDEX "commission_payable_items_barbershop_id_event_key_key" ON "commission_payable_items"("barbershop_id", "event_key");
CREATE INDEX "commission_payable_items_cycle_id_idx" ON "commission_payable_items"("cycle_id");
CREATE INDEX "commission_payable_items_entry_id_idx" ON "commission_payable_items"("entry_id");
CREATE INDEX "commission_payable_items_member_id_type_idx" ON "commission_payable_items"("member_id", "type");
CREATE INDEX "commission_payable_items_barbershop_id_created_at_idx" ON "commission_payable_items"("barbershop_id", "created_at");
CREATE INDEX "commission_payable_items_reverses_payable_item_id_idx" ON "commission_payable_items"("reverses_payable_item_id");

-- CreateIndex: commission_advances
CREATE UNIQUE INDEX "commission_advances_barbershop_id_idempotency_key_key" ON "commission_advances"("barbershop_id", "idempotency_key");
CREATE INDEX "commission_advances_cycle_id_idx" ON "commission_advances"("cycle_id");
CREATE INDEX "commission_advances_member_id_idx" ON "commission_advances"("member_id");
CREATE INDEX "commission_advances_barbershop_id_disbursed_at_idx" ON "commission_advances"("barbershop_id", "disbursed_at");

-- CreateIndex: commission_advance_reversals
CREATE UNIQUE INDEX "commission_advance_reversals_barbershop_id_idempotency_key_key" ON "commission_advance_reversals"("barbershop_id", "idempotency_key");
CREATE INDEX "commission_advance_reversals_advance_id_idx" ON "commission_advance_reversals"("advance_id");
CREATE INDEX "commission_advance_reversals_barbershop_id_returned_at_idx" ON "commission_advance_reversals"("barbershop_id", "returned_at");

-- CreateIndex: commission_payouts
CREATE UNIQUE INDEX "commission_payouts_cycle_id_key" ON "commission_payouts"("cycle_id");
CREATE UNIQUE INDEX "commission_payouts_barbershop_id_idempotency_key_key" ON "commission_payouts"("barbershop_id", "idempotency_key");
CREATE INDEX "commission_payouts_member_id_idx" ON "commission_payouts"("member_id");
CREATE INDEX "commission_payouts_barbershop_id_paid_at_idx" ON "commission_payouts"("barbershop_id", "paid_at");

-- CreateIndex: commission_cycle_adjustments
CREATE UNIQUE INDEX "commission_cycle_adjustments_source_payable_item_id_key" ON "commission_cycle_adjustments"("source_payable_item_id");
CREATE UNIQUE INDEX "commission_cycle_adjustments_source_advance_reversal_id_key" ON "commission_cycle_adjustments"("source_advance_reversal_id");
CREATE UNIQUE INDEX "commission_cycle_adjustments_source_adjustment_id_key" ON "commission_cycle_adjustments"("source_adjustment_id");
CREATE UNIQUE INDEX "commission_cycle_adjustments_barbershop_id_idempotency_key_key" ON "commission_cycle_adjustments"("barbershop_id", "idempotency_key");
CREATE INDEX "commission_cycle_adjustments_cycle_id_idx" ON "commission_cycle_adjustments"("cycle_id");
CREATE INDEX "commission_cycle_adjustments_barbershop_id_created_at_idx" ON "commission_cycle_adjustments"("barbershop_id", "created_at");

-- CreateIndex: commission_executor_correction_audits
CREATE UNIQUE INDEX "commission_executor_correction_audits_barbershop_id_idempotency_key_key" ON "commission_executor_correction_audits"("barbershop_id", "idempotency_key");
CREATE INDEX "commission_executor_correction_audits_comanda_item_id_idx" ON "commission_executor_correction_audits"("comanda_item_id");

-- CreateIndex: commission_advance_audits
CREATE INDEX "commission_advance_audits_advance_id_idx" ON "commission_advance_audits"("advance_id");

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_supersedes_entry_id_fkey" FOREIGN KEY ("supersedes_entry_id") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_commission_advance_id_fkey" FOREIGN KEY ("commission_advance_id") REFERENCES "commission_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_commission_advance_reversal_id_fkey" FOREIGN KEY ("commission_advance_reversal_id") REFERENCES "commission_advance_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_commission_payout_id_fkey" FOREIGN KEY ("commission_payout_id") REFERENCES "commission_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_commission_advance_id_fkey" FOREIGN KEY ("commission_advance_id") REFERENCES "commission_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_commission_advance_reversal_id_fkey" FOREIGN KEY ("commission_advance_reversal_id") REFERENCES "commission_advance_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_commission_payout_id_fkey" FOREIGN KEY ("commission_payout_id") REFERENCES "commission_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_cycles" ADD CONSTRAINT "commission_cycles_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_cycles" ADD CONSTRAINT "commission_cycles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "commission_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "command_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_source_comanda_id_fkey" FOREIGN KEY ("source_comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "commission_payable_items_reverses_payable_item_id_fkey" FOREIGN KEY ("reverses_payable_item_id") REFERENCES "commission_payable_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "commission_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advance_reversals" ADD CONSTRAINT "commission_advance_reversals_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_advance_reversals" ADD CONSTRAINT "commission_advance_reversals_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "commission_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_advance_reversals" ADD CONSTRAINT "commission_advance_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "commission_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "commission_cycle_adjustments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "commission_cycle_adjustments_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "commission_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "commission_cycle_adjustments_source_payable_item_id_fkey" FOREIGN KEY ("source_payable_item_id") REFERENCES "commission_payable_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "commission_cycle_adjustments_source_advance_reversal_id_fkey" FOREIGN KEY ("source_advance_reversal_id") REFERENCES "commission_advance_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "commission_cycle_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_comanda_item_id_fkey" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_old_entry_id_fkey" FOREIGN KEY ("old_entry_id") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_new_entry_id_fkey" FOREIGN KEY ("new_entry_id") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_old_member_id_fkey" FOREIGN KEY ("old_member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_new_member_id_fkey" FOREIGN KEY ("new_member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_executor_correction_audits" ADD CONSTRAINT "commission_executor_correction_audits_corrected_by_id_fkey" FOREIGN KEY ("corrected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advance_audits" ADD CONSTRAINT "commission_advance_audits_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_advance_audits" ADD CONSTRAINT "commission_advance_audits_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "commission_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_advance_audits" ADD CONSTRAINT "commission_advance_audits_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "commission_entries" ADD CONSTRAINT "chk_no_self_supersession" CHECK ("id" != "supersedes_entry_id");
ALTER TABLE "commission_payable_items" ADD CONSTRAINT "chk_payable_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "commission_advances" ADD CONSTRAINT "chk_advance_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "commission_advance_reversals" ADD CONSTRAINT "chk_advance_reversal_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "commission_payouts" ADD CONSTRAINT "chk_payout_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "commission_cycles" ADD CONSTRAINT "chk_cycle_number_positive" CHECK ("cycle_number" > 0);
ALTER TABLE "commission_cycles" ADD CONSTRAINT "chk_cycle_version_positive" CHECK ("version" > 0);
ALTER TABLE "commission_advance_audits" ADD CONSTRAINT "chk_advance_audit_field_notes_only" CHECK ("field" = 'notes');
ALTER TABLE "commission_payouts" ADD CONSTRAINT "chk_payout_method_consistency" CHECK (("amount" > 0 AND "payment_method" IS NOT NULL) OR ("amount" = 0 AND "payment_method" IS NULL));
ALTER TABLE "commission_cycles" ADD CONSTRAINT "chk_cycle_status_consistency" CHECK (("status" = 'OPEN' AND "closed_at" IS NULL AND "paid_at" IS NULL AND "final_payout_amount" = 0) OR ("status" = 'PAID' AND "closed_at" IS NOT NULL AND "paid_at" IS NOT NULL AND "remaining_balance" = 0));
ALTER TABLE "commission_cycle_adjustments" ADD CONSTRAINT "chk_adj_provenance_mutual_exclusivity" CHECK ((CASE WHEN "source_payable_item_id" IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN "source_advance_reversal_id" IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN "source_adjustment_id" IS NOT NULL THEN 1 ELSE 0 END) <= 1);
