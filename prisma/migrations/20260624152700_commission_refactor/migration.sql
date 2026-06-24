-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('SERVICE', 'PRODUCT');

-- AlterTable
ALTER TABLE "commission_adjustments" ADD COLUMN     "rollover_from_competence" TEXT,
ALTER COLUMN "entry_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "commission_configs" ADD COLUMN     "product_id" TEXT;

-- AlterTable
ALTER TABLE "commission_entries" ADD COLUMN     "type" "CommissionType" NOT NULL DEFAULT 'SERVICE';

-- CreateIndex
CREATE INDEX "commission_adjustments_rollover_from_competence_idx" ON "commission_adjustments"("rollover_from_competence");

-- CreateIndex
CREATE UNIQUE INDEX "commission_adjustments_barbershop_id_member_id_competence_r_key" ON "commission_adjustments"("barbershop_id", "member_id", "competence", "rollover_from_competence");

-- CreateIndex
CREATE INDEX "commission_configs_product_id_idx" ON "commission_configs"("product_id");

-- AddForeignKey
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
