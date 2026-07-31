-- AlterTable
ALTER TABLE "customer_club_subscriptions" ADD COLUMN "grace_period_end" TIMESTAMP(3);

-- Backfill existing rows with current_period_end + 1 day
UPDATE "customer_club_subscriptions"
SET "grace_period_end" = "current_period_end" + INTERVAL '1 day'
WHERE "grace_period_end" IS NULL;

-- Set column to NOT NULL
ALTER TABLE "customer_club_subscriptions" ALTER COLUMN "grace_period_end" SET NOT NULL;
