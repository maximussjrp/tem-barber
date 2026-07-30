-- CreateTable
CREATE TABLE "comanda_cancel_audits" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "comanda_id" TEXT NOT NULL,
    "cancelled_by_user_id" TEXT NOT NULL,
    "cancelled_by_member_id" TEXT,
    "reason" TEXT NOT NULL,
    "previous_status" "ComandaStatus" NOT NULL,
    "previous_total" DECIMAL(10,2) NOT NULL,
    "previous_paid_total" DECIMAL(10,2) NOT NULL,
    "previous_remaining_total" DECIMAL(10,2) NOT NULL,
    "refunded_total" DECIMAL(10,2) NOT NULL,
    "new_status" "ComandaStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comanda_cancel_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comanda_cancel_audits_barbershop_id_comanda_id_idx" ON "comanda_cancel_audits"("barbershop_id", "comanda_id");

-- CreateIndex
CREATE INDEX "comanda_cancel_audits_cancelled_by_user_id_idx" ON "comanda_cancel_audits"("cancelled_by_user_id");

-- CreateIndex
CREATE INDEX "comanda_cancel_audits_cancelled_by_member_id_idx" ON "comanda_cancel_audits"("cancelled_by_member_id");

-- AddForeignKey
ALTER TABLE "comanda_cancel_audits" ADD CONSTRAINT "comanda_cancel_audits_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_cancel_audits" ADD CONSTRAINT "comanda_cancel_audits_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_cancel_audits" ADD CONSTRAINT "comanda_cancel_audits_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_cancel_audits" ADD CONSTRAINT "comanda_cancel_audits_cancelled_by_member_id_fkey" FOREIGN KEY ("cancelled_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "service_commission_rules_barbershop_id_service_id_career_l_key" RENAME TO "service_commission_rules_barbershop_id_service_id_career_le_key";
