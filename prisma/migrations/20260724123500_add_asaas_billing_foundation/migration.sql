-- CreateEnum
CREATE TYPE "AsaasBillingEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "AsaasSubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED', 'OVERDUE', 'CANCELED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AsaasPaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'CANCELED', 'CHARGEBACK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AsaasWebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "asaas_billing_customers" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "asaas_customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "cpf_cnpj" TEXT,
    "phone" TEXT,
    "external_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asaas_billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_billing_subscriptions" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "asaas_subscription_id" TEXT NOT NULL,
    "asaas_customer_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" "AsaasSubscriptionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "next_due_date" TIMESTAMP(3),
    "billing_type" TEXT,
    "external_reference" TEXT NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asaas_billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_billing_payments" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "asaas_payment_id" TEXT NOT NULL,
    "asaas_subscription_id" TEXT,
    "asaas_customer_id" TEXT,
    "status" "AsaasPaymentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "billing_type" TEXT,
    "value" DECIMAL(10,2) NOT NULL,
    "net_value" DECIMAL(10,2),
    "due_date" TIMESTAMP(3),
    "payment_date" TIMESTAMP(3),
    "invoice_url" TEXT,
    "bank_slip_url" TEXT,
    "external_reference" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asaas_billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_webhook_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "asaas_event_id" TEXT,
    "payment_id" TEXT,
    "subscription_id" TEXT,
    "customer_id" TEXT,
    "barbershop_id" TEXT,
    "external_reference" TEXT,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "processing_status" "AsaasWebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processing_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asaas_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asaas_billing_customers_asaas_customer_id_key" ON "asaas_billing_customers"("asaas_customer_id");

-- CreateIndex
CREATE INDEX "asaas_billing_customers_barbershop_id_idx" ON "asaas_billing_customers"("barbershop_id");

-- CreateIndex
CREATE INDEX "asaas_billing_customers_external_reference_idx" ON "asaas_billing_customers"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_billing_subscriptions_asaas_subscription_id_key" ON "asaas_billing_subscriptions"("asaas_subscription_id");

-- CreateIndex
CREATE INDEX "asaas_billing_subscriptions_barbershop_id_idx" ON "asaas_billing_subscriptions"("barbershop_id");

-- CreateIndex
CREATE INDEX "asaas_billing_subscriptions_asaas_customer_id_idx" ON "asaas_billing_subscriptions"("asaas_customer_id");

-- CreateIndex
CREATE INDEX "asaas_billing_subscriptions_external_reference_idx" ON "asaas_billing_subscriptions"("external_reference");

-- CreateIndex
CREATE INDEX "asaas_billing_subscriptions_status_idx" ON "asaas_billing_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_billing_payments_asaas_payment_id_key" ON "asaas_billing_payments"("asaas_payment_id");

-- CreateIndex
CREATE INDEX "asaas_billing_payments_barbershop_id_idx" ON "asaas_billing_payments"("barbershop_id");

-- CreateIndex
CREATE INDEX "asaas_billing_payments_asaas_subscription_id_idx" ON "asaas_billing_payments"("asaas_subscription_id");

-- CreateIndex
CREATE INDEX "asaas_billing_payments_asaas_customer_id_idx" ON "asaas_billing_payments"("asaas_customer_id");

-- CreateIndex
CREATE INDEX "asaas_billing_payments_external_reference_idx" ON "asaas_billing_payments"("external_reference");

-- CreateIndex
CREATE INDEX "asaas_billing_payments_status_idx" ON "asaas_billing_payments"("status");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_event_idx" ON "asaas_webhook_events"("event");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_processing_status_idx" ON "asaas_webhook_events"("processing_status");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_barbershop_id_idx" ON "asaas_webhook_events"("barbershop_id");

-- CreateIndex
CREATE INDEX "asaas_webhook_events_external_reference_idx" ON "asaas_webhook_events"("external_reference");

-- AddForeignKey
ALTER TABLE "asaas_billing_customers" ADD CONSTRAINT "asaas_billing_customers_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_billing_subscriptions" ADD CONSTRAINT "asaas_billing_subscriptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_billing_payments" ADD CONSTRAINT "asaas_billing_payments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_webhook_events" ADD CONSTRAINT "asaas_webhook_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
