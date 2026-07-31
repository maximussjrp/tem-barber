-- CreateTable
CREATE TABLE "barbershop_blocked_customers" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "user_id" TEXT,
    "phone_normalized" TEXT NOT NULL,
    "name_snapshot" TEXT,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blocked_by_user_id" TEXT,
    "blocked_by_member_id" TEXT,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblocked_by_user_id" TEXT,
    "unblocked_by_member_id" TEXT,
    "unblocked_at" TIMESTAMP(3),
    "unblock_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barbershop_blocked_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "barbershop_blocked_customers_barbershop_id_active_idx" ON "barbershop_blocked_customers"("barbershop_id", "active");

-- CreateIndex
CREATE INDEX "barbershop_blocked_customers_user_id_idx" ON "barbershop_blocked_customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "barbershop_blocked_customers_barbershop_id_phone_normalized_key" ON "barbershop_blocked_customers"("barbershop_id", "phone_normalized");

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_blocked_by_user_id_fkey" FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_blocked_by_member_id_fkey" FOREIGN KEY ("blocked_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_unblocked_by_user_id_fkey" FOREIGN KEY ("unblocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_blocked_customers" ADD CONSTRAINT "barbershop_blocked_customers_unblocked_by_member_id_fkey" FOREIGN KEY ("unblocked_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
