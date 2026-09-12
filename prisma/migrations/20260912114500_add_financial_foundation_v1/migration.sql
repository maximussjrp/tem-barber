-- CreateEnum
CREATE TYPE "FinancialCategoryClassification" AS ENUM ('REVENUE', 'VARIABLE_COST', 'FIXED_EXPENSE', 'INVESTMENT', 'NON_OPERATING_IN', 'NON_OPERATING_OUT', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FinancialTitleKind" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateEnum
CREATE TYPE "FinancialRoutineAmountMode" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "FinancialRoutineFrequency" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "FinancialSettlementMethod" AS ENUM ('CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'BOLETO', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialTitleEventType" AS ENUM ('CREATED', 'UPDATED', 'CANCELLED', 'SETTLEMENT_CREATED', 'SETTLEMENT_REVERSED');

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classification" "FinancialCategoryClassification" NOT NULL,
    "parent_category_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_category_system_mappings" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "system_key" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_category_system_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_routines" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "FinancialTitleKind" NOT NULL,
    "amount_mode" "FinancialRoutineAmountMode" NOT NULL,
    "base_amount" DECIMAL(10,2),
    "frequency" "FinancialRoutineFrequency" NOT NULL DEFAULT 'MONTHLY',
    "due_day" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_titles" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "routine_id" TEXT,
    "category_id" TEXT NOT NULL,
    "kind" "FinancialTitleKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "original_amount" DECIMAL(10,2) NOT NULL,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "reference_month" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancel_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_settlements" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "principal_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "interest_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "method" "FinancialSettlementMethod",
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_settlement_reversals" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_settlement_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_title_events" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "type" "FinancialTitleEventType" NOT NULL,
    "payload" JSONB,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_title_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entry_allocations" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "financial_entry_id" TEXT NOT NULL,
    "financial_category_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_entry_allocations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "financial_entries" 
ADD COLUMN "financial_settlement_id" TEXT,
ADD COLUMN "financial_settlement_reversal_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_barbershop_id_code_key" ON "financial_categories"("barbershop_id", "code");
CREATE UNIQUE INDEX "financial_categories_id_barbershop_id_key" ON "financial_categories"("id", "barbershop_id");
CREATE INDEX "financial_categories_barbershop_id_classification_is_active_idx" ON "financial_categories"("barbershop_id", "classification", "is_active");
CREATE INDEX "financial_categories_barbershop_id_parent_category_id_idx" ON "financial_categories"("barbershop_id", "parent_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_category_system_mappings_barbershop_id_system_key_key" ON "financial_category_system_mappings"("barbershop_id", "system_key");
CREATE INDEX "financial_category_system_mappings_barbershop_id_category_id_idx" ON "financial_category_system_mappings"("barbershop_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_routines_id_barbershop_id_key" ON "financial_routines"("id", "barbershop_id");
CREATE INDEX "financial_routines_barbershop_id_is_active_idx" ON "financial_routines"("barbershop_id", "is_active");
CREATE INDEX "financial_routines_barbershop_id_category_id_idx" ON "financial_routines"("barbershop_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_titles_id_barbershop_id_key" ON "financial_titles"("id", "barbershop_id");
CREATE INDEX "financial_titles_barbershop_id_kind_due_on_idx" ON "financial_titles"("barbershop_id", "kind", "due_on");
CREATE INDEX "financial_titles_barbershop_id_due_on_idx" ON "financial_titles"("barbershop_id", "due_on");
CREATE INDEX "financial_titles_barbershop_id_category_id_idx" ON "financial_titles"("barbershop_id", "category_id");
CREATE INDEX "financial_titles_barbershop_id_routine_id_idx" ON "financial_titles"("barbershop_id", "routine_id");

-- Custom Partial Unique Index for Monthly Routines
CREATE UNIQUE INDEX "financial_titles_barbershop_routine_reference_month_uidx" ON "financial_titles"("barbershop_id", "routine_id", "reference_month") WHERE "routine_id" IS NOT NULL AND "reference_month" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "financial_settlements_barbershop_id_idempotency_key_key" ON "financial_settlements"("barbershop_id", "idempotency_key");
CREATE UNIQUE INDEX "financial_settlements_id_barbershop_id_key" ON "financial_settlements"("id", "barbershop_id");
CREATE INDEX "financial_settlements_barbershop_id_title_id_idx" ON "financial_settlements"("barbershop_id", "title_id");
CREATE INDEX "financial_settlements_barbershop_id_settled_at_idx" ON "financial_settlements"("barbershop_id", "settled_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_settlement_reversals_barbershop_id_settlement_id_key" ON "financial_settlement_reversals"("barbershop_id", "settlement_id");
CREATE UNIQUE INDEX "financial_settlement_reversals_barbershop_id_idempotency_key_key" ON "financial_settlement_reversals"("barbershop_id", "idempotency_key");
CREATE UNIQUE INDEX "financial_settlement_reversals_id_barbershop_id_key" ON "financial_settlement_reversals"("id", "barbershop_id");

-- CreateIndex
CREATE INDEX "financial_title_events_barbershop_id_title_id_created_at_idx" ON "financial_title_events"("barbershop_id", "title_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_allocations_barbershop_id_financial_entry_id_financial_category_id_key" ON "financial_entry_allocations"("barbershop_id", "financial_entry_id", "financial_category_id");
CREATE INDEX "financial_entry_allocations_barbershop_id_financial_entry_id_idx" ON "financial_entry_allocations"("barbershop_id", "financial_entry_id");
CREATE INDEX "financial_entry_allocations_barbershop_id_financial_category_id_idx" ON "financial_entry_allocations"("barbershop_id", "financial_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_id_barbershop_id_key" ON "financial_entries"("id", "barbershop_id");
CREATE UNIQUE INDEX "financial_entries_financial_settlement_id_barbershop_id_key" ON "financial_entries"("financial_settlement_id", "barbershop_id");
CREATE UNIQUE INDEX "financial_entries_financial_settlement_reversal_id_barbershop_id_key" ON "financial_entries"("financial_settlement_reversal_id", "barbershop_id");
CREATE INDEX "financial_entries_barbershop_id_financial_settlement_id_idx" ON "financial_entries"("barbershop_id", "financial_settlement_id");
CREATE INDEX "financial_entries_barbershop_id_financial_settlement_reversal_id_idx" ON "financial_entries"("barbershop_id", "financial_settlement_reversal_id");

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_parent_category_id_barbershop_id_fkey" FOREIGN KEY ("parent_category_id", "barbershop_id") REFERENCES "financial_categories"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_category_system_mappings" ADD CONSTRAINT "financial_category_system_mappings_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_category_system_mappings" ADD CONSTRAINT "financial_category_system_mappings_category_id_barbershop_id_fkey" FOREIGN KEY ("category_id", "barbershop_id") REFERENCES "financial_categories"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_routines" ADD CONSTRAINT "financial_routines_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_routines" ADD CONSTRAINT "financial_routines_category_id_barbershop_id_fkey" FOREIGN KEY ("category_id", "barbershop_id") REFERENCES "financial_categories"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_routines" ADD CONSTRAINT "financial_routines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_routine_id_barbershop_id_fkey" FOREIGN KEY ("routine_id", "barbershop_id") REFERENCES "financial_routines"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_category_id_barbershop_id_fkey" FOREIGN KEY ("category_id", "barbershop_id") REFERENCES "financial_categories"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_title_id_barbershop_id_fkey" FOREIGN KEY ("title_id", "barbershop_id") REFERENCES "financial_titles"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_settlement_reversals" ADD CONSTRAINT "financial_settlement_reversals_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_settlement_reversals" ADD CONSTRAINT "financial_settlement_reversals_settlement_id_barbershop_id_fkey" FOREIGN KEY ("settlement_id", "barbershop_id") REFERENCES "financial_settlements"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_settlement_reversals" ADD CONSTRAINT "financial_settlement_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_title_events" ADD CONSTRAINT "financial_title_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_title_events" ADD CONSTRAINT "financial_title_events_title_id_barbershop_id_fkey" FOREIGN KEY ("title_id", "barbershop_id") REFERENCES "financial_titles"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_title_events" ADD CONSTRAINT "financial_title_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry_allocations" ADD CONSTRAINT "financial_entry_allocations_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_entry_allocations" ADD CONSTRAINT "financial_entry_allocations_financial_entry_id_barbershop_id_fkey" FOREIGN KEY ("financial_entry_id", "barbershop_id") REFERENCES "financial_entries"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entry_allocations" ADD CONSTRAINT "financial_entry_allocations_financial_category_id_barbershop_id_fkey" FOREIGN KEY ("financial_category_id", "barbershop_id") REFERENCES "financial_categories"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_financial_settlement_id_barbershop_id_fkey" FOREIGN KEY ("financial_settlement_id", "barbershop_id") REFERENCES "financial_settlements"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_financial_settlement_reversal_id_barbershop_id_fkey" FOREIGN KEY ("financial_settlement_reversal_id", "barbershop_id") REFERENCES "financial_settlement_reversals"("id", "barbershop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom Check Constraints
ALTER TABLE "financial_routines" ADD CONSTRAINT "chk_financial_routines_due_day" CHECK ("due_day" BETWEEN 1 AND 31);
ALTER TABLE "financial_routines" ADD CONSTRAINT "chk_financial_routines_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "financial_routines" ADD CONSTRAINT "chk_financial_routines_base_amount" CHECK ("base_amount" IS NULL OR "base_amount" > 0);
ALTER TABLE "financial_routines" ADD CONSTRAINT "chk_financial_routines_fixed_amount" CHECK ("amount_mode" <> 'FIXED' OR "base_amount" IS NOT NULL);

ALTER TABLE "financial_titles" ADD CONSTRAINT "chk_financial_titles_original_amount" CHECK ("original_amount" > 0);
ALTER TABLE "financial_titles" ADD CONSTRAINT "chk_financial_titles_routine_ref_month" CHECK (("routine_id" IS NULL AND "reference_month" IS NULL) OR ("routine_id" IS NOT NULL AND "reference_month" IS NOT NULL));

ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_principal_amount" CHECK ("principal_amount" > 0);
ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_discount_amount" CHECK ("discount_amount" >= 0);
ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_interest_amount" CHECK ("interest_amount" >= 0);
ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_fine_amount" CHECK ("fine_amount" >= 0);
ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_discount_limit" CHECK ("discount_amount" <= "principal_amount");
ALTER TABLE "financial_settlements" ADD CONSTRAINT "chk_financial_settlements_cash_method_consistency" CHECK ((("principal_amount" - "discount_amount" + "interest_amount" + "fine_amount") = 0 AND "method" IS NULL) OR (("principal_amount" - "discount_amount" + "interest_amount" + "fine_amount") > 0 AND "method" IS NOT NULL));

ALTER TABLE "financial_entries" ADD CONSTRAINT "chk_financial_entries_provenance_exclusive" CHECK (NOT ("financial_settlement_id" IS NOT NULL AND "financial_settlement_reversal_id" IS NOT NULL));

ALTER TABLE "financial_entry_allocations" ADD CONSTRAINT "chk_financial_entry_allocations_amount" CHECK ("allocated_amount" <> 0);
