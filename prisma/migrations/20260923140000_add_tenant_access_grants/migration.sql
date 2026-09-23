-- CreateTable
CREATE TABLE "tenant_access_grants" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "days_granted" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_email" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_by_email" TEXT,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_access_grants_barbershop_id_revoked_at_starts_at_end_idx" ON "tenant_access_grants"("barbershop_id", "revoked_at", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "tenant_access_grants_barbershop_id_created_at_idx" ON "tenant_access_grants"("barbershop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_access_grants_barbershop_id_idempotency_key_key" ON "tenant_access_grants"("barbershop_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "tenant_access_grants" ADD CONSTRAINT "tenant_access_grants_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "tenant_access_grants"
ADD CONSTRAINT "tenant_access_grants_days_granted_check"
CHECK ("days_granted" BETWEEN 1 AND 3650);

ALTER TABLE "tenant_access_grants"
ADD CONSTRAINT "tenant_access_grants_window_check"
CHECK ("ends_at" > "starts_at");

ALTER TABLE "tenant_access_grants"
ADD CONSTRAINT "tenant_access_grants_reason_not_blank_check"
CHECK (btrim("reason") <> '');
