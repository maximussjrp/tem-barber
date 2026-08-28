import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260828150000_add_nullable_plan_code/migration.sql",
  "utf8"
);

describe("Plan code expand migration", () => {
  it("declares code as nullable and unique during the expand stage", () => {
    expect(schema).toMatch(/model Plan \{[\s\S]*?code\s+String\?\s+@unique/);
  });

  it("is structural-only and reusable across environments", () => {
    expect(migration).toContain('ALTER TABLE "plans" ADD COLUMN "code" TEXT;');
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
