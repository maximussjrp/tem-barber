-- AlterTable
ALTER TABLE "asaas_billing_subscriptions" ADD COLUMN     "source_event_at" TIMESTAMP(3),
ADD COLUMN     "source_event_id" TEXT;
