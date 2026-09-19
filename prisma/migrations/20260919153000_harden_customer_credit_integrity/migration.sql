-- AlterEnum
ALTER TYPE "CreditSourceKind" ADD VALUE 'COMANDA_REFUND';

-- DropForeignKey
ALTER TABLE "customer_credit_accounts" DROP CONSTRAINT "customer_credit_accounts_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_credit_accounts" DROP CONSTRAINT "customer_credit_accounts_barbershop_id_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_credit_entries" DROP CONSTRAINT "customer_credit_entries_account_id_fkey";

-- DropIndex
DROP INDEX "customer_credit_entries_barbershop_id_idempotency_key_idx";

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_barbershop_id_idempotency_key_key" ON "customer_credit_entries"("barbershop_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_barbershop_id_customer_id_fkey" FOREIGN KEY ("barbershop_id", "customer_id") REFERENCES "customer_barbershop_links"("barbershop_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
