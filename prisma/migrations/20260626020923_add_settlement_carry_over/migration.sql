-- AlterTable
ALTER TABLE "club_settlements" ADD COLUMN     "carry_in_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "carry_out_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
