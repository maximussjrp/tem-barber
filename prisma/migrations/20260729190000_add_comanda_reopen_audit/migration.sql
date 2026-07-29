CREATE TABLE "comanda_reopen_audits" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "comanda_id" TEXT NOT NULL,
    "reopened_by_user_id" TEXT NOT NULL,
    "reopened_by_member_id" TEXT,
    "reason" TEXT NOT NULL,
    "previous_status" "ComandaStatus" NOT NULL,
    "new_status" "ComandaStatus" NOT NULL,
    "previous_total" DECIMAL(10,2) NOT NULL,
    "previous_paid_total" DECIMAL(10,2) NOT NULL,
    "previous_remaining_total" DECIMAL(10,2) NOT NULL,
    "new_total" DECIMAL(10,2) NOT NULL,
    "new_paid_total" DECIMAL(10,2) NOT NULL,
    "new_remaining_total" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comanda_reopen_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comanda_reopen_audits_barbershop_id_comanda_id_idx" ON "comanda_reopen_audits"("barbershop_id", "comanda_id");
CREATE INDEX "comanda_reopen_audits_reopened_by_user_id_idx" ON "comanda_reopen_audits"("reopened_by_user_id");
CREATE INDEX "comanda_reopen_audits_reopened_by_member_id_idx" ON "comanda_reopen_audits"("reopened_by_member_id");

ALTER TABLE "comanda_reopen_audits" ADD CONSTRAINT "comanda_reopen_audits_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comanda_reopen_audits" ADD CONSTRAINT "comanda_reopen_audits_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comanda_reopen_audits" ADD CONSTRAINT "comanda_reopen_audits_reopened_by_user_id_fkey" FOREIGN KEY ("reopened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comanda_reopen_audits" ADD CONSTRAINT "comanda_reopen_audits_reopened_by_member_id_fkey" FOREIGN KEY ("reopened_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
