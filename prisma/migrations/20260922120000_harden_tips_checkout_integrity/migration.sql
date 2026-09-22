-- AlterEnum
ALTER TYPE "TipStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

-- CreateEnum
CREATE TYPE "CheckoutMode" AS ENUM ('FINALIZE', 'DEBT_PAYMENT');

-- AlterTable CheckoutTransaction
ALTER TABLE "checkout_transactions"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "payload_fingerprint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mode" "CheckoutMode" NOT NULL DEFAULT 'FINALIZE';

-- Remove default from payload_fingerprint so future inserts must supply it
ALTER TABLE "checkout_transactions" ALTER COLUMN "payload_fingerprint" DROP DEFAULT;

-- CreateUniqueIndex for CheckoutTransaction tenant + idempotencyKey
CREATE UNIQUE INDEX "checkout_transactions_barbershop_id_idempotency_key_key" ON "checkout_transactions"("barbershop_id", "idempotency_key");

-- AlterTable TipEntry
ALTER TABLE "tip_entries"
  ADD COLUMN "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN "paid_out_amount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- Drop Index on TipRefund tip_entry_id if unique and add normal index
DROP INDEX IF EXISTS "tip_refunds_tip_entry_id_key";
CREATE INDEX "tip_refunds_barbershop_id_tip_entry_id_idx" ON "tip_refunds"("barbershop_id", "tip_entry_id");

-- Add DB Check Constraints
ALTER TABLE "tip_entries"
  ADD CONSTRAINT "chk_tip_entries_amount_pos" CHECK (amount > 0),
  ADD CONSTRAINT "chk_tip_entries_refunded_pos" CHECK (refunded_amount >= 0),
  ADD CONSTRAINT "chk_tip_entries_paid_out_pos" CHECK (paid_out_amount >= 0),
  ADD CONSTRAINT "chk_tip_entries_refund_paid_sum" CHECK (refunded_amount + paid_out_amount <= amount);

ALTER TABLE "tip_refunds"
  ADD CONSTRAINT "chk_tip_refunds_amount_pos" CHECK (amount > 0);

ALTER TABLE "tip_payouts"
  ADD CONSTRAINT "chk_tip_payouts_total_amount_pos" CHECK (total_amount > 0);

ALTER TABLE "tip_payout_allocations"
  ADD CONSTRAINT "chk_tip_payout_allocations_amount_pos" CHECK (amount > 0);

ALTER TABLE "checkout_allocations"
  ADD CONSTRAINT "chk_checkout_allocations_received_pos" CHECK (received_amount >= 0),
  ADD CONSTRAINT "chk_checkout_allocations_allocated_pos" CHECK (allocated_amount >= 0);

ALTER TABLE "checkout_transactions"
  ADD CONSTRAINT "chk_checkout_transactions_equation" CHECK (total_received_amount = total_sale_applied + total_tip_amount + total_credit_deposit + total_change_amount);