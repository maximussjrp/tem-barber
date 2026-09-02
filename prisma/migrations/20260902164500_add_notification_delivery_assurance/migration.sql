-- CreateEnum
CREATE TYPE "NotificationProviderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('APPOINTMENT', 'WAITLIST', 'FINANCIAL', 'SYSTEM');

-- AlterTable
ALTER TABLE "web_push_subscriptions" ADD COLUMN     "device_id" TEXT;

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_instance_id" TEXT NOT NULL,
    "platform" TEXT,
    "browser" TEXT,
    "device_class" TEXT,
    "display_name" TEXT,
    "local_readiness" TEXT,
    "notification_permission" TEXT,
    "push_permission" TEXT,
    "service_worker_state" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "last_health_check_at" TIMESTAMP(3),
    "last_subscription_reconciled_at" TIMESTAMP(3),
    "last_push_receipt_at" TIMESTAMP(3),
    "last_notification_created_at" TIMESTAMP(3),
    "last_notification_click_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "device_id" TEXT,
    "subscription_id" TEXT,
    "endpoint_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_status" "NotificationProviderStatus" NOT NULL DEFAULT 'PENDING',
    "provider_status_code" INTEGER,
    "provider_accepted_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_classification" TEXT,
    "receipt_token_hash" TEXT,
    "receipt_token_expires_at" TIMESTAMP(3),
    "service_worker_received_at" TIMESTAMP(3),
    "browser_notification_created_at" TIMESTAMP(3),
    "browser_notification_failed_at" TIMESTAMP(3),
    "browser_failure_classification" TEXT,
    "clicked_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_devices_user_id_revoked_at_idx" ON "push_devices"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "push_devices_last_seen_at_idx" ON "push_devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_user_id_device_instance_id_key" ON "push_devices"("user_id", "device_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_device_id_created_at_idx" ON "notification_deliveries"("device_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_subscription_id_idx" ON "notification_deliveries"("subscription_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_provider_status_service_worker_rece_idx" ON "notification_deliveries"("provider_status", "service_worker_received_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "global_notification_preferences_user_id_category_key" ON "global_notification_preferences"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_notification_preferences_user_id_barbershop_id_categ_key" ON "tenant_notification_preferences"("user_id", "barbershop_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_device_id_key" ON "web_push_subscriptions"("device_id");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "push_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "web_push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_notification_preferences" ADD CONSTRAINT "global_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notification_preferences" ADD CONSTRAINT "tenant_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notification_preferences" ADD CONSTRAINT "tenant_notification_preferences_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "push_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

