-- Drop obsolete R2.1 check constraint to allow both booking and comanda return attribution
ALTER TABLE "reactivation_campaign_recipients" DROP CONSTRAINT "chk_single_attribution";

-- AlterTable
ALTER TABLE "reactivation_campaigns" ADD COLUMN "attribution_version" VARCHAR(64) NOT NULL DEFAULT 'smart-crm-attribution-v1';
ALTER TABLE "reactivation_campaigns" ALTER COLUMN "direct_return_window_days" SET DEFAULT 30;

-- AlterTable
ALTER TABLE "reactivation_campaign_recipients" ADD COLUMN "canonical_return_date" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "reactivation_campaign_recipients_barbershop_id_customer_id_canonical_return_date_key" ON "reactivation_campaign_recipients"("barbershop_id", "customer_id", "canonical_return_date");

-- CreateIndex
CREATE INDEX "appointments_barbershop_id_customer_id_created_at_idx" ON "appointments"("barbershop_id", "customer_id", "created_at");
