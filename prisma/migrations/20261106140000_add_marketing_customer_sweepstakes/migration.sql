-- CreateEnum
CREATE TYPE "SweepstakeStatus" AS ENUM ('DRAFT', 'REGULATION_PENDING', 'ACTIVE', 'FROZEN', 'DRAWN', 'AUDITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SweepstakeParticipationMode" AS ENUM ('ONE_PER_CUSTOMER', 'ONE_PER_APPOINTMENT', 'ONE_PER_SERVICE');

-- CreateEnum
CREATE TYPE "SweepstakeCustomerSegment" AS ENUM ('ALL_CUSTOMERS', 'CLUB_ONLY', 'REGULAR_ONLY');

-- CreateEnum
CREATE TYPE "SweepstakeDrawMethod" AS ENUM ('ELECTRONIC_DETERMINISTIC', 'FEDERAL_LOTTERY');

-- CreateTable
CREATE TABLE "customer_sweepstakes" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "start_date_civil" VARCHAR(10) NOT NULL,
    "end_date_civil" VARCHAR(10) NOT NULL,
    "start_inclusive_utc" TIMESTAMP(3) NOT NULL,
    "end_exclusive_utc" TIMESTAMP(3) NOT NULL,
    "draw_date_scheduled" TIMESTAMP(3) NOT NULL,
    "status" "SweepstakeStatus" NOT NULL DEFAULT 'DRAFT',
    "participation_mode" "SweepstakeParticipationMode" NOT NULL DEFAULT 'ONE_PER_CUSTOMER',
    "target_segment" "SweepstakeCustomerSegment" NOT NULL DEFAULT 'ALL_CUSTOMERS',
    "service_ids" JSONB,
    "allow_multiple_prizes_per_user" BOOLEAN NOT NULL DEFAULT false,
    "draw_method" "SweepstakeDrawMethod" NOT NULL DEFAULT 'ELECTRONIC_DETERMINISTIC',
    "is_regulated_promotion" BOOLEAN NOT NULL DEFAULT false,
    "authorization_code" TEXT,
    "regulations_summary" TEXT,
    "regulations_document_url" TEXT,
    "federal_lottery_contest_number" TEXT,
    "total_eligible_customers" INTEGER NOT NULL DEFAULT 0,
    "total_eligible_visits" INTEGER NOT NULL DEFAULT 0,
    "total_eligible_services" INTEGER NOT NULL DEFAULT 0,
    "total_chances_assigned" INTEGER NOT NULL DEFAULT 0,
    "tickets_sha256_digest" TEXT,
    "precommitted_seed" TEXT,
    "frozen_at" TIMESTAMP(3),
    "drawn_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_sweepstakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_prizes" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,

    CONSTRAINT "customer_sweepstake_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_participants" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "is_club_member_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "chances_count" INTEGER NOT NULL DEFAULT 1,
    "eligible_visits_count" INTEGER NOT NULL DEFAULT 0,
    "eligible_services_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sweepstake_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_chance_origins" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "comanda_id" TEXT,
    "comanda_item_id" TEXT,
    "service_id" TEXT,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "chances_granted" INTEGER NOT NULL DEFAULT 1,
    "justification" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sweepstake_chance_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_tickets" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sweepstake_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_winners" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "winning_ticket_number" INTEGER NOT NULL,
    "prize_position" INTEGER NOT NULL,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT NOT NULL,
    "prize_delivered" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3),
    "delivery_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sweepstake_winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sweepstake_draw_audits" (
    "id" TEXT NOT NULL,
    "sweepstake_id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "drawn_by_id" TEXT NOT NULL,
    "drawn_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draw_method" "SweepstakeDrawMethod" NOT NULL,
    "seed_used" TEXT NOT NULL,
    "tickets_sha256_snapshot" TEXT NOT NULL,
    "audit_log_json" JSONB NOT NULL,

    CONSTRAINT "customer_sweepstake_draw_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstakes_id_barbershop_id_key" ON "customer_sweepstakes"("id", "barbershop_id");
CREATE INDEX "customer_sweepstakes_barbershop_id_status_draw_date_scheduled_idx" ON "customer_sweepstakes"("barbershop_id", "status", "draw_date_scheduled");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstake_prizes_sweepstake_id_position_key" ON "customer_sweepstake_prizes"("sweepstake_id", "position");
CREATE INDEX "customer_sweepstake_prizes_barbershop_id_sweepstake_id_idx" ON "customer_sweepstake_prizes"("barbershop_id", "sweepstake_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstake_participants_sweepstake_id_customer_id_key" ON "customer_sweepstake_participants"("sweepstake_id", "customer_id");
CREATE INDEX "customer_sweepstake_participants_barbershop_id_customer_id_idx" ON "customer_sweepstake_participants"("barbershop_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_sweepstake_chance_origins_barbershop_id_sweepstake_idx" ON "customer_sweepstake_chance_origins"("barbershop_id", "sweepstake_id");
CREATE INDEX "customer_sweepstake_chance_origins_participant_id_idx" ON "customer_sweepstake_chance_origins"("participant_id");
CREATE INDEX "customer_sweepstake_chance_origins_customer_id_idx" ON "customer_sweepstake_chance_origins"("customer_id");
CREATE INDEX "customer_sweepstake_chance_origins_appointment_id_idx" ON "customer_sweepstake_chance_origins"("appointment_id");
CREATE INDEX "customer_sweepstake_chance_origins_comanda_id_idx" ON "customer_sweepstake_chance_origins"("comanda_id");
CREATE INDEX "customer_sweepstake_chance_origins_comanda_item_id_idx" ON "customer_sweepstake_chance_origins"("comanda_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstake_tickets_sweepstake_id_ticket_number_key" ON "customer_sweepstake_tickets"("sweepstake_id", "ticket_number");
CREATE INDEX "customer_sweepstake_tickets_sweepstake_id_participant_id_idx" ON "customer_sweepstake_tickets"("sweepstake_id", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstake_winners_sweepstake_id_prize_position_key" ON "customer_sweepstake_winners"("sweepstake_id", "prize_position");
CREATE INDEX "customer_sweepstake_winners_sweepstake_id_participant_id_idx" ON "customer_sweepstake_winners"("sweepstake_id", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sweepstake_draw_audits_sweepstake_id_key" ON "customer_sweepstake_draw_audits"("sweepstake_id");
CREATE UNIQUE INDEX "customer_sweepstake_draw_audits_sweepstake_id_barbershop_id_key" ON "customer_sweepstake_draw_audits"("sweepstake_id", "barbershop_id");

-- AddForeignKey
ALTER TABLE "customer_sweepstakes" ADD CONSTRAINT "customer_sweepstakes_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstakes" ADD CONSTRAINT "customer_sweepstakes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_prizes" ADD CONSTRAINT "customer_sweepstake_prizes_sweepstake_id_barbershop_id_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_participants" ADD CONSTRAINT "customer_sweepstake_participants_sweepstake_id_barbershop_id_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_participants" ADD CONSTRAINT "customer_sweepstake_participants_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_chance_origins" ADD CONSTRAINT "customer_sweepstake_chance_origins_sweepstake_id_barbershop_i_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_chance_origins" ADD CONSTRAINT "customer_sweepstake_chance_origins_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "customer_sweepstake_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_chance_origins" ADD CONSTRAINT "customer_sweepstake_chance_origins_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_tickets" ADD CONSTRAINT "customer_sweepstake_tickets_sweepstake_id_barbershop_id_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_tickets" ADD CONSTRAINT "customer_sweepstake_tickets_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "customer_sweepstake_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_winners" ADD CONSTRAINT "customer_sweepstake_winners_sweepstake_id_barbershop_id_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_winners" ADD CONSTRAINT "customer_sweepstake_winners_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "customer_sweepstake_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sweepstake_draw_audits" ADD CONSTRAINT "customer_sweepstake_draw_audits_sweepstake_id_barbershop_id_fkey" FOREIGN KEY ("sweepstake_id", "barbershop_id") REFERENCES "customer_sweepstakes"("id", "barbershop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_sweepstake_draw_audits" ADD CONSTRAINT "customer_sweepstake_draw_audits_drawn_by_id_fkey" FOREIGN KEY ("drawn_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
