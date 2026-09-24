-- AlterEnum
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'RECEPTIONIST';

-- CreateEnum
CREATE TYPE "StaffAccessTokenPurpose" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "staff_access_tokens" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "StaffAccessTokenPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_permission_overrides" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_access_tokens_token_hash_key" ON "staff_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_access_tokens_barbershop_id_user_id_idx" ON "staff_access_tokens"("barbershop_id", "user_id");

-- CreateIndex
CREATE INDEX "staff_access_tokens_purpose_expires_at_idx" ON "staff_access_tokens"("purpose", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_permission_overrides_member_id_permission_key_key" ON "member_permission_overrides"("member_id", "permission_key");

-- CreateIndex
CREATE INDEX "member_permission_overrides_barbershop_id_member_id_idx" ON "member_permission_overrides"("barbershop_id", "member_id");

-- AddForeignKey
ALTER TABLE "staff_access_tokens" ADD CONSTRAINT "staff_access_tokens_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_access_tokens" ADD CONSTRAINT "staff_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_access_tokens" ADD CONSTRAINT "staff_access_tokens_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
