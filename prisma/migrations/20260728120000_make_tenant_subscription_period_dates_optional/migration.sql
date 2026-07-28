-- AlterTable
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "period_start" DROP NOT NULL,
ALTER COLUMN "period_end" DROP NOT NULL;
