-- AlterTable
ALTER TABLE "barbershop_members" ADD COLUMN "career_level_id" TEXT;

-- CreateTable
CREATE TABLE "career_levels" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "default_commission_rate" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_commission_rules" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "career_level_id" TEXT NOT NULL,
    "type" "CommissionConfigType" NOT NULL DEFAULT 'PERCENTAGE',
    "commission_rate" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_levels_barbershop_id_active_idx" ON "career_levels"("barbershop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "career_levels_barbershop_id_name_key" ON "career_levels"("barbershop_id", "name");

-- CreateIndex
CREATE INDEX "service_commission_rules_barbershop_id_service_id_idx" ON "service_commission_rules"("barbershop_id", "service_id");

-- CreateIndex
CREATE INDEX "service_commission_rules_barbershop_id_career_level_id_idx" ON "service_commission_rules"("barbershop_id", "career_level_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_commission_rules_barbershop_id_service_id_career_l_key" ON "service_commission_rules"("barbershop_id", "service_id", "career_level_id");

-- CreateIndex
CREATE INDEX "barbershop_members_career_level_id_idx" ON "barbershop_members"("career_level_id");

-- AddForeignKey
ALTER TABLE "barbershop_members" ADD CONSTRAINT "barbershop_members_career_level_id_fkey" FOREIGN KEY ("career_level_id") REFERENCES "career_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_levels" ADD CONSTRAINT "career_levels_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_commission_rules" ADD CONSTRAINT "service_commission_rules_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_commission_rules" ADD CONSTRAINT "service_commission_rules_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_commission_rules" ADD CONSTRAINT "service_commission_rules_career_level_id_fkey" FOREIGN KEY ("career_level_id") REFERENCES "career_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
