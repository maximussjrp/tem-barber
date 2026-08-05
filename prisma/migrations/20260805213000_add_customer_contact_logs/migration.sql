-- CreateTable
CREATE TABLE "customer_contact_logs" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "template_label" VARCHAR(120) NOT NULL,
    "note" VARCHAR(500),
    "contacted_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_contact_logs_barbershop_id_customer_id_contacted_at_idx" ON "customer_contact_logs"("barbershop_id", "customer_id", "contacted_at");

-- CreateIndex
CREATE INDEX "customer_contact_logs_barbershop_id_contacted_at_idx" ON "customer_contact_logs"("barbershop_id", "contacted_at");

-- CreateIndex
CREATE INDEX "customer_contact_logs_customer_id_idx" ON "customer_contact_logs"("customer_id");

-- CreateIndex
CREATE INDEX "customer_contact_logs_created_by_user_id_idx" ON "customer_contact_logs"("created_by_user_id");

-- CreateIndex
CREATE INDEX "customer_contact_logs_created_by_member_id_idx" ON "customer_contact_logs"("created_by_member_id");

-- AddForeignKey
ALTER TABLE "customer_contact_logs" ADD CONSTRAINT "customer_contact_logs_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_logs" ADD CONSTRAINT "customer_contact_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_logs" ADD CONSTRAINT "customer_contact_logs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_logs" ADD CONSTRAINT "customer_contact_logs_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
