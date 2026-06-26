-- CreateEnum
CREATE TYPE "ClubPlanBenefitType" AS ENUM ('INCLUDED_SERVICE', 'SERVICE_DISCOUNT', 'PRODUCT_DISCOUNT');

-- CreateEnum
CREATE TYPE "ClubSubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ClubPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClubPointStatus" AS ENUM ('GENERATED', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ClubSettlementStatus" AS ENUM ('CALCULATED', 'APPROVED', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClubBenefitUsageStatus" AS ENUM ('APPLIED', 'REVERSED');

-- CreateTable
CREATE TABLE "club_plans" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_price" DECIMAL(10,2) NOT NULL,
    "shop_share_percent" DECIMAL(5,2) NOT NULL,
    "barber_pool_percent" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_plan_benefits" (
    "id" TEXT NOT NULL,
    "club_plan_id" TEXT NOT NULL,
    "benefit_type" "ClubPlanBenefitType" NOT NULL,
    "service_id" TEXT,
    "product_id" TEXT,
    "included_qty" INTEGER,
    "discount_percent" DECIMAL(5,2),
    "point_weight" DECIMAL(10,4),

    CONSTRAINT "club_plan_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_club_subscriptions" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "club_plan_id" TEXT NOT NULL,
    "status" "ClubSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_club_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_subscription_payments" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "club_plan_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "status" "ClubPaymentStatus" NOT NULL DEFAULT 'PAID',
    "competence" TEXT NOT NULL,
    "shop_share_percent_snapshot" DECIMAL(5,2) NOT NULL,
    "barber_pool_percent_snapshot" DECIMAL(5,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_benefit_usages" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "club_plan_id" TEXT NOT NULL,
    "club_plan_benefit_id" TEXT,
    "comanda_item_id" TEXT NOT NULL,
    "service_id" TEXT,
    "product_id" TEXT,
    "benefit_type" "ClubPlanBenefitType" NOT NULL,
    "original_amount" DECIMAL(10,2),
    "covered_amount" DECIMAL(10,2),
    "discount_amount" DECIMAL(10,2),
    "point_weight_applied" DECIMAL(10,4),
    "status" "ClubBenefitUsageStatus" NOT NULL DEFAULT 'APPLIED',
    "competence" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_benefit_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_point_entries" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "comanda_item_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "points" DECIMAL(10,4) NOT NULL,
    "status" "ClubPointStatus" NOT NULL DEFAULT 'GENERATED',
    "competence" TEXT NOT NULL,
    "settlement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_settlements" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "total_revenue" DECIMAL(10,2) NOT NULL,
    "shop_share_percent" DECIMAL(5,2),
    "shop_amount" DECIMAL(10,2) NOT NULL,
    "barber_pool_amount" DECIMAL(10,2) NOT NULL,
    "total_points" DECIMAL(10,4) NOT NULL,
    "status" "ClubSettlementStatus" NOT NULL DEFAULT 'CALCULATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_settlement_members" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "points" DECIMAL(10,4) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "club_settlement_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_plans_barbershop_id_is_active_idx" ON "club_plans"("barbershop_id", "is_active");

-- CreateIndex
CREATE INDEX "club_plan_benefits_club_plan_id_idx" ON "club_plan_benefits"("club_plan_id");

-- CreateIndex
CREATE INDEX "club_plan_benefits_service_id_idx" ON "club_plan_benefits"("service_id");

-- CreateIndex
CREATE INDEX "club_plan_benefits_product_id_idx" ON "club_plan_benefits"("product_id");

-- CreateIndex
CREATE INDEX "customer_club_subscriptions_barbershop_id_customer_id_idx" ON "customer_club_subscriptions"("barbershop_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_club_subscriptions_barbershop_id_status_idx" ON "customer_club_subscriptions"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "club_subscription_payments_barbershop_id_subscription_id_idx" ON "club_subscription_payments"("barbershop_id", "subscription_id");

-- CreateIndex
CREATE INDEX "club_subscription_payments_customer_id_idx" ON "club_subscription_payments"("customer_id");

-- CreateIndex
CREATE INDEX "club_subscription_payments_club_plan_id_idx" ON "club_subscription_payments"("club_plan_id");

-- CreateIndex
CREATE INDEX "club_subscription_payments_paid_at_idx" ON "club_subscription_payments"("paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "club_benefit_usages_comanda_item_id_key" ON "club_benefit_usages"("comanda_item_id");

-- CreateIndex
CREATE INDEX "club_benefit_usages_barbershop_id_subscription_id_idx" ON "club_benefit_usages"("barbershop_id", "subscription_id");

-- CreateIndex
CREATE INDEX "club_benefit_usages_club_plan_id_idx" ON "club_benefit_usages"("club_plan_id");

-- CreateIndex
CREATE INDEX "club_benefit_usages_club_plan_benefit_id_idx" ON "club_benefit_usages"("club_plan_benefit_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_point_entries_comanda_item_id_key" ON "club_point_entries"("comanda_item_id");

-- CreateIndex
CREATE INDEX "club_point_entries_barbershop_id_competence_idx" ON "club_point_entries"("barbershop_id", "competence");

-- CreateIndex
CREATE INDEX "club_point_entries_member_id_competence_idx" ON "club_point_entries"("member_id", "competence");

-- CreateIndex
CREATE INDEX "club_point_entries_settlement_id_idx" ON "club_point_entries"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_settlements_barbershop_id_competence_key" ON "club_settlements"("barbershop_id", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "club_settlement_members_settlement_id_member_id_key" ON "club_settlement_members"("settlement_id", "member_id");

-- AddForeignKey
ALTER TABLE "club_plans" ADD CONSTRAINT "club_plans_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_plan_benefits" ADD CONSTRAINT "club_plan_benefits_club_plan_id_fkey" FOREIGN KEY ("club_plan_id") REFERENCES "club_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_plan_benefits" ADD CONSTRAINT "club_plan_benefits_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_plan_benefits" ADD CONSTRAINT "club_plan_benefits_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_club_subscriptions" ADD CONSTRAINT "customer_club_subscriptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_club_subscriptions" ADD CONSTRAINT "customer_club_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_club_subscriptions" ADD CONSTRAINT "customer_club_subscriptions_club_plan_id_fkey" FOREIGN KEY ("club_plan_id") REFERENCES "club_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payments" ADD CONSTRAINT "club_subscription_payments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payments" ADD CONSTRAINT "club_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_club_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payments" ADD CONSTRAINT "club_subscription_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payments" ADD CONSTRAINT "club_subscription_payments_club_plan_id_fkey" FOREIGN KEY ("club_plan_id") REFERENCES "club_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_club_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_club_plan_id_fkey" FOREIGN KEY ("club_plan_id") REFERENCES "club_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_club_plan_benefit_id_fkey" FOREIGN KEY ("club_plan_benefit_id") REFERENCES "club_plan_benefits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_comanda_item_id_fkey" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_benefit_usages" ADD CONSTRAINT "club_benefit_usages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_point_entries" ADD CONSTRAINT "club_point_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_point_entries" ADD CONSTRAINT "club_point_entries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_club_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_point_entries" ADD CONSTRAINT "club_point_entries_comanda_item_id_fkey" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_point_entries" ADD CONSTRAINT "club_point_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_point_entries" ADD CONSTRAINT "club_point_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "club_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_settlements" ADD CONSTRAINT "club_settlements_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_settlement_members" ADD CONSTRAINT "club_settlement_members_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "club_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_settlement_members" ADD CONSTRAINT "club_settlement_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
