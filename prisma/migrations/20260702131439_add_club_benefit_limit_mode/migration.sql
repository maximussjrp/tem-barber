-- CreateEnum
CREATE TYPE "ClubBenefitLimitMode" AS ENUM ('UNLIMITED', 'MONTHLY_LIMIT');

-- AlterTable
ALTER TABLE "club_plan_benefits" ADD COLUMN     "benefit_limit_mode" "ClubBenefitLimitMode" NOT NULL DEFAULT 'MONTHLY_LIMIT';
