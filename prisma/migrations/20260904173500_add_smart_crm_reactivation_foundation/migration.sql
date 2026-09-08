-- CreateEnum
CREATE TYPE "MarketingConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "MarketingConsentSource" AS ENUM ('BOOKING_CHECKBOX', 'CUSTOMER_REQUEST_WHATSAPP', 'CUSTOMER_REQUEST_IN_PERSON', 'ADMIN_WITH_PROOF', 'IMPORT_WITH_PROOF');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientDispatchStatus" AS ENUM ('READY', 'EXCLUDED', 'WHATSAPP_OPENED', 'SENT_CONFIRMED', 'FAILED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "RecipientConversionStatus" AS ENUM ('NONE', 'BOOKED', 'ATTENDED', 'DIRECT_RETURN', 'REVENUE_ATTRIBUTED');

-- CreateEnum
CREATE TYPE "CustomerTimingState" AS ENUM ('NO_HISTORY', 'NOT_DUE', 'DUE_SOON', 'DUE', 'OVERDUE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ExpectedReturnSource" AS ENUM ('PERSONAL', 'SERVICE_MEDIAN', 'BARBERSHOP_MEDIAN', 'PLATFORM_FALLBACK');

-- AlterTable
ALTER TABLE "customer_contact_logs" ADD COLUMN "reactivation_recipient_id" TEXT;

-- CreateTable
CREATE TABLE "customer_marketing_consents" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "status" "MarketingConsentStatus" NOT NULL,
    "source" "MarketingConsentSource" NOT NULL,
    "evidence" TEXT,
    "last_event_id" TEXT,
    "opted_out_at" TIMESTAMP(3),
    "last_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_marketing_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_marketing_consent_events" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "event_type" "MarketingConsentStatus" NOT NULL,
    "source" "MarketingConsentSource" NOT NULL,
    "reason" TEXT,
    "evidence" TEXT,
    "event_key" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_member_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_marketing_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactivation_campaigns" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "target_segment" JSONB NOT NULL,
    "score_version" VARCHAR(64) NOT NULL DEFAULT 'smart-crm-score-v1',
    "recurrence_version" VARCHAR(64) NOT NULL DEFAULT 'smart-crm-recurrence-v1',
    "booking_attribution_window_days" INTEGER NOT NULL DEFAULT 14,
    "direct_return_window_days" INTEGER NOT NULL DEFAULT 14,
    "cooldown_days" INTEGER NOT NULL DEFAULT 14,
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_by_member_id" TEXT,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "converted_count" INTEGER NOT NULL DEFAULT 0,
    "total_revenue_attributed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reactivation_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactivation_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT NOT NULL,
    "timing_state_snapshot" "CustomerTimingState" NOT NULL,
    "score_snapshot" INTEGER NOT NULL,
    "expected_return_date_snapshot" TIMESTAMP(3),
    "expected_return_source_snapshot" "ExpectedReturnSource",
    "last_visit_date_snapshot" TIMESTAMP(3),
    "days_overdue_snapshot" INTEGER,
    "avg_ticket_snapshot" DECIMAL(10,2),
    "preferred_member_id_snapshot" TEXT,
    "preferred_service_id_snapshot" TEXT,
    "dispatch_status" "RecipientDispatchStatus" NOT NULL DEFAULT 'READY',
    "dispatch_error" TEXT,
    "dispatch_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "payload_snapshot" JSONB,
    "external_message_id" TEXT,
    "sent_confirmed_at" TIMESTAMP(3),
    "conversion_status" "RecipientConversionStatus" NOT NULL DEFAULT 'NONE',
    "attributed_appointment_id" TEXT,
    "attributed_comanda_id" TEXT,
    "conversion_attributed_at" TIMESTAMP(3),
    "revenue_attributed" DECIMAL(10,2),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reactivation_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: customer_contact_logs
CREATE UNIQUE INDEX "customer_contact_logs_reactivation_recipient_id_key" ON "customer_contact_logs"("reactivation_recipient_id");

-- CreateIndex: customer_marketing_consents
CREATE UNIQUE INDEX "customer_marketing_consents_barbershop_id_customer_id_channel_purpose_key" ON "customer_marketing_consents"("barbershop_id", "customer_id", "channel", "purpose");
CREATE INDEX "customer_marketing_consents_barbershop_id_status_idx" ON "customer_marketing_consents"("barbershop_id", "status");

-- CreateIndex: customer_marketing_consent_events
CREATE UNIQUE INDEX "customer_marketing_consent_events_barbershop_id_event_key_key" ON "customer_marketing_consent_events"("barbershop_id", "event_key");
CREATE INDEX "customer_marketing_consent_events_barbershop_id_customer_id_occurred_at_idx" ON "customer_marketing_consent_events"("barbershop_id", "customer_id", "occurred_at");

-- CreateIndex: reactivation_campaigns
CREATE UNIQUE INDEX "reactivation_campaigns_id_barbershop_id_key" ON "reactivation_campaigns"("id", "barbershop_id");
CREATE INDEX "reactivation_campaigns_barbershop_id_status_created_at_idx" ON "reactivation_campaigns"("barbershop_id", "status", "created_at");

-- CreateIndex: reactivation_campaign_recipients
CREATE UNIQUE INDEX "reactivation_campaign_recipients_campaign_id_customer_id_key" ON "reactivation_campaign_recipients"("campaign_id", "customer_id");
CREATE INDEX "reactivation_campaign_recipients_barbershop_id_customer_id_sent_confirmed_at_idx" ON "reactivation_campaign_recipients"("barbershop_id", "customer_id", "sent_confirmed_at");
CREATE INDEX "reactivation_campaign_recipients_barbershop_id_conversion_status_idx" ON "reactivation_campaign_recipients"("barbershop_id", "conversion_status");
CREATE INDEX "reactivation_campaign_recipients_barbershop_id_sent_confirmed_at_idx" ON "reactivation_campaign_recipients"("barbershop_id", "sent_confirmed_at");
CREATE INDEX "reactivation_campaign_recipients_campaign_id_dispatch_status_idx" ON "reactivation_campaign_recipients"("campaign_id", "dispatch_status");

-- CreateIndex: targeted indexes on existing models
CREATE INDEX "appointments_barbershop_id_customer_id_status_date_time_idx" ON "appointments"("barbershop_id", "customer_id", "status", "date_time");
CREATE INDEX "comandas_barbershop_id_customer_id_status_closed_at_idx" ON "comandas"("barbershop_id", "customer_id", "status", "closed_at");
CREATE INDEX "comanda_items_barbershop_id_type_status_completed_at_idx" ON "comanda_items"("barbershop_id", "type", "status", "completed_at");

-- AddForeignKey: customer_contact_logs
ALTER TABLE "customer_contact_logs" ADD CONSTRAINT "customer_contact_logs_reactivation_recipient_id_fkey" FOREIGN KEY ("reactivation_recipient_id") REFERENCES "reactivation_campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: customer_marketing_consents
ALTER TABLE "customer_marketing_consents" ADD CONSTRAINT "customer_marketing_consents_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_marketing_consents" ADD CONSTRAINT "customer_marketing_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_marketing_consents" ADD CONSTRAINT "customer_marketing_consents_last_event_id_fkey" FOREIGN KEY ("last_event_id") REFERENCES "customer_marketing_consent_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: customer_marketing_consent_events
ALTER TABLE "customer_marketing_consent_events" ADD CONSTRAINT "customer_marketing_consent_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_marketing_consent_events" ADD CONSTRAINT "customer_marketing_consent_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_marketing_consent_events" ADD CONSTRAINT "customer_marketing_consent_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_marketing_consent_events" ADD CONSTRAINT "customer_marketing_consent_events_actor_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: reactivation_campaigns
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: reactivation_campaign_recipients
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_campaign_id_barbershop_id_fkey" FOREIGN KEY ("campaign_id", "barbershop_id") REFERENCES "reactivation_campaigns"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_preferred_member_id_snapshot_fkey" FOREIGN KEY ("preferred_member_id_snapshot") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_preferred_service_id_snapshot_fkey" FOREIGN KEY ("preferred_service_id_snapshot") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_attributed_appointment_id_fkey" FOREIGN KEY ("attributed_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "reactivation_campaign_recipients_attributed_comanda_id_fkey" FOREIGN KEY ("attributed_comanda_id") REFERENCES "comandas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "reactivation_campaign_recipients" ADD CONSTRAINT "chk_single_attribution" CHECK (NOT ("attributed_appointment_id" IS NOT NULL AND "attributed_comanda_id" IS NOT NULL));
