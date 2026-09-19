-- CreateEnum
CREATE TYPE "CreditEntryType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "CreditSourceKind" AS ENUM ('OVERPAYMENT', 'MANUAL_GRANT', 'ADJUSTMENT', 'REFUND_TO_CREDIT', 'COMANDA_PAYMENT');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CUSTOMER_CREDIT';

-- CreateTable
CREATE TABLE "customer_credit_accounts" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "type" "CreditEntryType" NOT NULL,
    "source_kind" "CreditSourceKind" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "comanda_id" TEXT,
    "payment_id" TEXT,
    "created_by_user_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_credit_accounts_barbershop_id_customer_id_idx" ON "customer_credit_accounts"("barbershop_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_accounts_barbershop_id_customer_id_key" ON "customer_credit_accounts"("barbershop_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_credit_entries_account_id_created_at_idx" ON "customer_credit_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_credit_entries_barbershop_id_created_at_idx" ON "customer_credit_entries"("barbershop_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_credit_entries_barbershop_id_idempotency_key_idx" ON "customer_credit_entries"("barbershop_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_barbershop_id_customer_id_fkey" FOREIGN KEY ("barbershop_id", "customer_id") REFERENCES "customer_barbershop_links"("barbershop_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
