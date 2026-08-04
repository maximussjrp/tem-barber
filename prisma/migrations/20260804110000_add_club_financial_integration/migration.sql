-- AlterEnum
ALTER TYPE "FinancialEntryType" ADD VALUE 'CLUB_REVENUE';
ALTER TYPE "FinancialEntryType" ADD VALUE 'CLUB_BARBER_PAYOUT';

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "club_subscription_payment_id" TEXT,
ADD COLUMN     "settlement_id" TEXT,
ADD COLUMN     "settlement_member_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_club_subscription_payment_id_key" ON "financial_entries"("club_subscription_payment_id");

-- CreateIndex
CREATE INDEX "financial_entries_settlement_id_idx" ON "financial_entries"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_settlement_member_id_key" ON "financial_entries"("settlement_member_id");

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_club_subscription_payment_id_fkey" FOREIGN KEY ("club_subscription_payment_id") REFERENCES "club_subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "club_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_settlement_member_id_fkey" FOREIGN KEY ("settlement_member_id") REFERENCES "club_settlement_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
