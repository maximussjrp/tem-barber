-- CreateEnum
CREATE TYPE "TipStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'PAID_OUT', 'PAID_OUT_REVERSED');

-- CreateEnum
CREATE TYPE "TipPayoutStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('SALE_PAYMENT', 'TIP', 'CUSTOMER_CREDIT_DEPOSIT');

-- AlterEnum
ALTER TYPE "CreditSourceKind" ADD VALUE 'OVERPAYMENT_REVERSAL';

-- AlterEnum
ALTER TYPE "FinancialEntryType" ADD VALUE 'TIP_RECEIVED';
ALTER TYPE "FinancialEntryType" ADD VALUE 'TIP_REFUND';
ALTER TYPE "FinancialEntryType" ADD VALUE 'TIP_PAYOUT';
ALTER TYPE "FinancialEntryType" ADD VALUE 'TIP_PAYOUT_REVERSAL';
ALTER TYPE "FinancialEntryType" ADD VALUE 'CUSTOMER_CREDIT_DEPOSIT';
ALTER TYPE "FinancialEntryType" ADD VALUE 'CUSTOMER_CREDIT_DEPOSIT_REFUND';

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "customer_credit_entry_id" TEXT,
ADD COLUMN     "tip_entry_id" TEXT,
ADD COLUMN     "tip_payout_id" TEXT,
ADD COLUMN     "tip_payout_reversal_id" TEXT,
ADD COLUMN     "tip_refund_id" TEXT;

-- AlterTable
ALTER TABLE "command_payments" ADD COLUMN     "checkout_allocation_id" TEXT;

-- AlterTable
ALTER TABLE "customer_credit_entries" ADD COLUMN     "checkout_allocation_id" TEXT,
ADD COLUMN     "funding_method" "PaymentMethod",
ADD COLUMN     "reversal_of_entry_id" TEXT;

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "customer_credit_entry_id" TEXT,
ADD COLUMN     "tip_entry_id" TEXT,
ADD COLUMN     "tip_payout_id" TEXT,
ADD COLUMN     "tip_payout_reversal_id" TEXT,
ADD COLUMN     "tip_refund_id" TEXT;

-- CreateTable
CREATE TABLE "checkout_transactions" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "comanda_id" TEXT NOT NULL,
    "total_received_amount" DECIMAL(10,2) NOT NULL,
    "total_sale_applied" DECIMAL(10,2) NOT NULL,
    "total_tip_amount" DECIMAL(10,2) NOT NULL,
    "total_credit_deposit" DECIMAL(10,2) NOT NULL,
    "total_change_amount" DECIMAL(10,2) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_allocations" (
    "id" TEXT NOT NULL,
    "checkout_transaction_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "tender_method" "PaymentMethod" NOT NULL,
    "received_amount" DECIMAL(10,2) NOT NULL,
    "allocation_kind" "AllocationKind" NOT NULL,
    "allocated_amount" DECIMAL(10,2) NOT NULL,
    "tip_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_entries" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "comanda_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "TipStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkout_allocation_id" TEXT,
    "created_by_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tip_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_refunds" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "tip_entry_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "refunded_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_payouts" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "TipPayoutStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_payout_allocations" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "tip_entry_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_payout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_payout_reversals" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_payout_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_tip_entry_id_key" ON "cash_movements"("tip_entry_id");
CREATE UNIQUE INDEX "cash_movements_tip_refund_id_key" ON "cash_movements"("tip_refund_id");
CREATE UNIQUE INDEX "cash_movements_tip_payout_id_key" ON "cash_movements"("tip_payout_id");
CREATE UNIQUE INDEX "cash_movements_tip_payout_reversal_id_key" ON "cash_movements"("tip_payout_reversal_id");
CREATE UNIQUE INDEX "cash_movements_customer_credit_entry_id_key" ON "cash_movements"("customer_credit_entry_id");

-- CreateIndex
CREATE INDEX "checkout_transactions_barbershop_id_comanda_id_idx" ON "checkout_transactions"("barbershop_id", "comanda_id");
CREATE INDEX "checkout_transactions_barbershop_id_created_at_idx" ON "checkout_transactions"("barbershop_id", "created_at");

-- CreateIndex
CREATE INDEX "checkout_allocations_barbershop_id_checkout_transaction_idx" ON "checkout_allocations"("barbershop_id", "checkout_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "tip_entries_checkout_allocation_id_key" ON "tip_entries"("checkout_allocation_id");
CREATE UNIQUE INDEX "tip_entries_barbershop_id_idempotency_key_key" ON "tip_entries"("barbershop_id", "idempotency_key");
CREATE INDEX "tip_entries_barbershop_id_comanda_id_idx" ON "tip_entries"("barbershop_id", "comanda_id");
CREATE INDEX "tip_entries_barbershop_id_member_id_status_idx" ON "tip_entries"("barbershop_id", "member_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tip_refunds_tip_entry_id_key" ON "tip_refunds"("tip_entry_id");
CREATE UNIQUE INDEX "tip_refunds_barbershop_id_idempotency_key_key" ON "tip_refunds"("barbershop_id", "idempotency_key");
CREATE INDEX "tip_refunds_barbershop_id_created_at_idx" ON "tip_refunds"("barbershop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tip_payouts_barbershop_id_idempotency_key_key" ON "tip_payouts"("barbershop_id", "idempotency_key");
CREATE INDEX "tip_payouts_barbershop_id_member_id_created_at_idx" ON "tip_payouts"("barbershop_id", "member_id", "created_at");

-- CreateIndex
CREATE INDEX "tip_payout_allocations_tip_entry_id_idx" ON "tip_payout_allocations"("tip_entry_id");
CREATE UNIQUE INDEX "tip_payout_allocations_payout_id_tip_entry_id_key" ON "tip_payout_allocations"("payout_id", "tip_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "tip_payout_reversals_payout_id_key" ON "tip_payout_reversals"("payout_id");
CREATE UNIQUE INDEX "tip_payout_reversals_barbershop_id_idempotency_key_key" ON "tip_payout_reversals"("barbershop_id", "idempotency_key");
CREATE INDEX "tip_payout_reversals_barbershop_id_created_at_idx" ON "tip_payout_reversals"("barbershop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "command_payments_checkout_allocation_id_key" ON "command_payments"("checkout_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_checkout_allocation_id_key" ON "customer_credit_entries"("checkout_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_tip_entry_id_key" ON "financial_entries"("tip_entry_id");
CREATE UNIQUE INDEX "financial_entries_tip_refund_id_key" ON "financial_entries"("tip_refund_id");
CREATE UNIQUE INDEX "financial_entries_tip_payout_id_key" ON "financial_entries"("tip_payout_id");
CREATE UNIQUE INDEX "financial_entries_tip_payout_reversal_id_key" ON "financial_entries"("tip_payout_reversal_id");
CREATE UNIQUE INDEX "financial_entries_customer_credit_entry_id_key" ON "financial_entries"("customer_credit_entry_id");

-- AddForeignKey
ALTER TABLE "command_payments" ADD CONSTRAINT "command_payments_checkout_allocation_id_fkey" FOREIGN KEY ("checkout_allocation_id") REFERENCES "checkout_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tip_refund_id_fkey" FOREIGN KEY ("tip_refund_id") REFERENCES "tip_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tip_payout_id_fkey" FOREIGN KEY ("tip_payout_id") REFERENCES "tip_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tip_payout_reversal_id_fkey" FOREIGN KEY ("tip_payout_reversal_id") REFERENCES "tip_payout_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_customer_credit_entry_id_fkey" FOREIGN KEY ("customer_credit_entry_id") REFERENCES "customer_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tip_refund_id_fkey" FOREIGN KEY ("tip_refund_id") REFERENCES "tip_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tip_payout_id_fkey" FOREIGN KEY ("tip_payout_id") REFERENCES "tip_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tip_payout_reversal_id_fkey" FOREIGN KEY ("tip_payout_reversal_id") REFERENCES "tip_payout_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_customer_credit_entry_id_fkey" FOREIGN KEY ("customer_credit_entry_id") REFERENCES "customer_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_checkout_allocation_id_fkey" FOREIGN KEY ("checkout_allocation_id") REFERENCES "checkout_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_reversal_of_entry_id_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "customer_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "checkout_transactions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "checkout_transactions_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "checkout_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_allocations" ADD CONSTRAINT "checkout_allocations_checkout_transaction_id_fkey" FOREIGN KEY ("checkout_transaction_id") REFERENCES "checkout_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkout_allocations" ADD CONSTRAINT "checkout_allocations_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkout_allocations" ADD CONSTRAINT "checkout_allocations_tip_member_id_fkey" FOREIGN KEY ("tip_member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_checkout_allocation_id_fkey" FOREIGN KEY ("checkout_allocation_id") REFERENCES "checkout_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_refunds" ADD CONSTRAINT "tip_refunds_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_refunds" ADD CONSTRAINT "tip_refunds_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_refunds" ADD CONSTRAINT "tip_refunds_refunded_by_id_fkey" FOREIGN KEY ("refunded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payouts" ADD CONSTRAINT "tip_payouts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_payouts" ADD CONSTRAINT "tip_payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_payouts" ADD CONSTRAINT "tip_payouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payout_allocations" ADD CONSTRAINT "tip_payout_allocations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "tip_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_payout_allocations" ADD CONSTRAINT "tip_payout_allocations_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payout_reversals" ADD CONSTRAINT "tip_payout_reversals_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_payout_reversals" ADD CONSTRAINT "tip_payout_reversals_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "tip_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_payout_reversals" ADD CONSTRAINT "tip_payout_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DB-Level CHECK Constraints for Invariants
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_positive_received" CHECK ("total_received_amount" > 0);
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_non_negative_sale" CHECK ("total_sale_applied" >= 0);
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_non_negative_tip" CHECK ("total_tip_amount" >= 0);
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_non_negative_deposit" CHECK ("total_credit_deposit" >= 0);
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_non_negative_change" CHECK ("total_change_amount" >= 0);
ALTER TABLE "checkout_transactions" ADD CONSTRAINT "chk_checkout_balance_equation" CHECK ("total_received_amount" = "total_sale_applied" + "total_tip_amount" + "total_credit_deposit" + "total_change_amount");

ALTER TABLE "checkout_allocations" ADD CONSTRAINT "chk_allocation_positive_received" CHECK ("received_amount" > 0);
ALTER TABLE "checkout_allocations" ADD CONSTRAINT "chk_allocation_positive_allocated" CHECK ("allocated_amount" > 0);

ALTER TABLE "tip_entries" ADD CONSTRAINT "chk_tip_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "tip_refunds" ADD CONSTRAINT "chk_tip_refund_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "tip_payouts" ADD CONSTRAINT "chk_tip_payout_positive_amount" CHECK ("total_amount" > 0);

-- CreateTable
CREATE TABLE "tip_payout_reversal_allocations" (
    "id" TEXT NOT NULL,
    "reversal_id" TEXT NOT NULL,
    "tip_payout_allocation_id" TEXT NOT NULL,
    "tip_entry_id" TEXT NOT NULL,
    "amount_restored" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_payout_reversal_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tip_payout_reversal_allocations_reversal_id_idx" ON "tip_payout_reversal_allocations"("reversal_id");
CREATE INDEX "tip_payout_reversal_allocations_tip_entry_id_idx" ON "tip_payout_reversal_allocations"("tip_entry_id");

ALTER TABLE "tip_payout_reversal_allocations" ADD CONSTRAINT "tip_payout_reversal_allocations_reversal_id_fkey" FOREIGN KEY ("reversal_id") REFERENCES "tip_payout_reversals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tip_payout_reversal_allocations" ADD CONSTRAINT "tip_payout_reversal_allocations_tip_payout_allocation_id_fkey" FOREIGN KEY ("tip_payout_allocation_id") REFERENCES "tip_payout_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tip_payout_reversal_allocations" ADD CONSTRAINT "tip_payout_reversal_allocations_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
