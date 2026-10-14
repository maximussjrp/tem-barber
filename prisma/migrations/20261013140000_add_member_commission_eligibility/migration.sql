-- AlterTable
ALTER TABLE "barbershop_members" ADD COLUMN "is_commission_eligible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "member_commission_eligibility_events" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_commission_eligibility_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_commission_eligibility_events_barbershop_id_member_i_idx" ON "member_commission_eligibility_events"("barbershop_id", "member_id", "effective_at");

-- AddForeignKey
ALTER TABLE "member_commission_eligibility_events" ADD CONSTRAINT "member_commission_eligibility_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_commission_eligibility_events" ADD CONSTRAINT "member_commission_eligibility_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_commission_eligibility_events" ADD CONSTRAINT "member_commission_eligibility_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
