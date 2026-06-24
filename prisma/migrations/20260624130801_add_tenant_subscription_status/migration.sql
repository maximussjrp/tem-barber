/*
  Warnings:

  - You are about to drop the `payments` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_appointment_id_fkey";

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "grace_period_ends_at" TIMESTAMP(3),
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "last_payment_at" TIMESTAMP(3),
ADD COLUMN     "monthly_price" DECIMAL(10,2),
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "plan_name" TEXT,
ADD COLUMN     "updated_by" TEXT;

-- DropTable
DROP TABLE "payments";
