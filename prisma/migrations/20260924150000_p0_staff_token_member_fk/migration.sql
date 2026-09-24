-- AlterTable
ALTER TABLE "staff_access_tokens" ADD COLUMN "member_id" TEXT;

-- Backfill from BarbershopMember for existing tokens if any
UPDATE "staff_access_tokens" sat
SET "member_id" = bm.id
FROM "barbershop_members" bm
WHERE bm.barbershop_id = sat.barbershop_id AND bm.user_id = sat.user_id;

-- Make member_id NOT NULL
ALTER TABLE "staff_access_tokens" ALTER COLUMN "member_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "staff_access_tokens_barbershop_id_member_id_idx" ON "staff_access_tokens"("barbershop_id", "member_id");

-- AddForeignKey
ALTER TABLE "staff_access_tokens" ADD CONSTRAINT "staff_access_tokens_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
