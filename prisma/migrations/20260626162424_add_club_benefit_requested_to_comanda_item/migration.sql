-- AlterTable
ALTER TABLE "comanda_items" ADD COLUMN     "club_benefit_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requested_club_plan_benefit_id" TEXT;
