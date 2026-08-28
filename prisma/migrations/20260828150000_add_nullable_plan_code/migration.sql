-- Expand-only migration: existing plans remain valid with a NULL code.
ALTER TABLE "plans" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
