import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260828150000_add_nullable_plan_code/migration.sql",
  "utf8"
);

describe("Plan code expand migration (D1 historical artifact)", () => {
  it("verifies D1 migration artifact added column as nullable TEXT without NOT NULL constraint", () => {
    expect(migration).toContain('ALTER TABLE "plans" ADD COLUMN "code" TEXT;');
    expect(migration).not.toMatch(/ADD COLUMN "code" TEXT NOT NULL/i);
  });

  it("verifies D1 migration created unique index and remained structural-only", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");'
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/i);
    expect(migration).not.toContain("d4e9563f-fe5f-42ee-8577-d9c6136a6828");
    expect(migration).not.toContain("pro_monthly");
    expect(migration).not.toContain("founder_2026");
    expect(migration).not.toContain("tenant_subscriptions");
  });
});
