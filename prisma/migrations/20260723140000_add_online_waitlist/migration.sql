-- CreateEnum
CREATE TYPE "OnlineWaitlistSessionStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OnlineWaitlistEntryStatus" AS ENUM ('WAITING', 'CALLED', 'FIT_IN_CREATED', 'IN_SERVICE', 'COMPLETED', 'SKIPPED', 'NO_SHOW', 'MOVED_TO_END', 'CANCELED_BY_CUSTOMER', 'CANCELED_BY_SHOP', 'EXPIRED');

-- CreateTable
CREATE TABLE "online_waitlist_sessions" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "status" "OnlineWaitlistSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "title" TEXT,
    "notes" TEXT,
    "default_lock_before_appointment_minutes" INTEGER NOT NULL DEFAULT 20,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_waitlist_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_waitlist_entries" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "preferred_member_id" TEXT,
    "queue_number" INTEGER NOT NULL,
    "position_weight" INTEGER NOT NULL,
    "status" "OnlineWaitlistEntryStatus" NOT NULL DEFAULT 'WAITING',
    "skip_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "public_token_hash" TEXT NOT NULL,
    "public_token_hint" TEXT,
    "called_by_member_id" TEXT,
    "called_at" TIMESTAMP(3),
    "fit_in_appointment_id" TEXT,
    "canceled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_waitlist_member_configs" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lock_before_appointment_minutes" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_waitlist_member_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "online_waitlist_sessions_barbershop_id_status_idx" ON "online_waitlist_sessions"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "online_waitlist_entries_session_id_status_idx" ON "online_waitlist_entries"("session_id", "status");

-- CreateIndex
CREATE INDEX "online_waitlist_entries_barbershop_id_status_idx" ON "online_waitlist_entries"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "online_waitlist_entries_public_token_hash_idx" ON "online_waitlist_entries"("public_token_hash");

-- CreateIndex
CREATE INDEX "online_waitlist_entries_customer_id_idx" ON "online_waitlist_entries"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_waitlist_member_configs_member_id_key" ON "online_waitlist_member_configs"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_waitlist_member_configs_barbershop_id_member_id_key" ON "online_waitlist_member_configs"("barbershop_id", "member_id");

-- AddForeignKey
ALTER TABLE "online_waitlist_sessions" ADD CONSTRAINT "online_waitlist_sessions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_sessions" ADD CONSTRAINT "online_waitlist_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "online_waitlist_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_preferred_member_id_fkey" FOREIGN KEY ("preferred_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_called_by_member_id_fkey" FOREIGN KEY ("called_by_member_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_entries" ADD CONSTRAINT "online_waitlist_entries_fit_in_appointment_id_fkey" FOREIGN KEY ("fit_in_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_member_configs" ADD CONSTRAINT "online_waitlist_member_configs_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_waitlist_member_configs" ADD CONSTRAINT "online_waitlist_member_configs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
