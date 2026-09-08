-- CreateEnum
CREATE TYPE "MetaConnectionStatus" AS ENUM ('INITIATED', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MetaOnboardingSessionStatus" AS ENUM ('INITIATED', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MetaConnectionEventType" AS ENUM ('ONBOARDING_STARTED', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'RECONNECTED', 'CONFIG_UPDATED', 'HEALTH_CHECK_FAILED', 'HEALTH_CHECK_PASSED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "meta_connections" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "business_id" TEXT,
    "waba_id" TEXT,
    "phone_number_id" TEXT,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "quality_rating" TEXT,
    "waba_review_status" TEXT,
    "status" "MetaConnectionStatus" NOT NULL DEFAULT 'INITIATED',
    "connected_at" TIMESTAMP(3),
    "system_user_assigned_at" TIMESTAMP(3),
    "webhook_subscribed_at" TIMESTAMP(3),
    "phone_registered_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "last_provider_sync_at" TIMESTAMP(3),
    "last_health_check_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_connection_secrets" (
    "id" TEXT NOT NULL,
    "meta_connection_id" TEXT NOT NULL,
    "registration_pin_ciphertext" TEXT NOT NULL,
    "registration_pin_iv" TEXT NOT NULL,
    "registration_pin_auth_tag" TEXT NOT NULL,
    "encryption_key_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_connection_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_onboarding_sessions" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "status" "MetaOnboardingSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_connection_events" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "meta_connection_id" TEXT,
    "type" "MetaConnectionEventType" NOT NULL,
    "actor_user_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "waba_id" TEXT,
    "phone_number_id" TEXT,
    "provider_message_id" TEXT,
    "meta_connection_id" TEXT,
    "barbershop_id" TEXT,
    "provider_occurred_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "processing_status" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "processing_error" TEXT,
    "signature_verified_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_connections_barbershop_id_key" ON "meta_connections"("barbershop_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_connections_phone_number_id_key" ON "meta_connections"("phone_number_id");

-- CreateIndex
CREATE INDEX "meta_connections_waba_id_idx" ON "meta_connections"("waba_id");

-- CreateIndex
CREATE INDEX "meta_connections_status_idx" ON "meta_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "meta_connection_secrets_meta_connection_id_key" ON "meta_connection_secrets"("meta_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_onboarding_sessions_nonce_hash_key" ON "meta_onboarding_sessions"("nonce_hash");

-- CreateIndex
CREATE INDEX "meta_onboarding_sessions_barbershop_id_status_expires_at_idx" ON "meta_onboarding_sessions"("barbershop_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "meta_onboarding_sessions_created_by_user_id_idx" ON "meta_onboarding_sessions"("created_by_user_id");

-- CreateIndex
CREATE INDEX "meta_connection_events_barbershop_id_created_at_idx" ON "meta_connection_events"("barbershop_id", "created_at");

-- CreateIndex
CREATE INDEX "meta_connection_events_meta_connection_id_created_at_idx" ON "meta_connection_events"("meta_connection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_provider_event_key_key" ON "webhook_inbox"("provider", "event_key");

-- CreateIndex
CREATE INDEX "webhook_inbox_processing_status_received_at_idx" ON "webhook_inbox"("processing_status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_inbox_barbershop_id_received_at_idx" ON "webhook_inbox"("barbershop_id", "received_at");

-- CreateIndex
CREATE INDEX "webhook_inbox_phone_number_id_received_at_idx" ON "webhook_inbox"("phone_number_id", "received_at");

-- AddForeignKey
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_connection_secrets" ADD CONSTRAINT "meta_connection_secrets_meta_connection_id_fkey" FOREIGN KEY ("meta_connection_id") REFERENCES "meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_onboarding_sessions" ADD CONSTRAINT "meta_onboarding_sessions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_onboarding_sessions" ADD CONSTRAINT "meta_onboarding_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_connection_events" ADD CONSTRAINT "meta_connection_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_connection_events" ADD CONSTRAINT "meta_connection_events_meta_connection_id_fkey" FOREIGN KEY ("meta_connection_id") REFERENCES "meta_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_connection_events" ADD CONSTRAINT "meta_connection_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_meta_connection_id_fkey" FOREIGN KEY ("meta_connection_id") REFERENCES "meta_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
