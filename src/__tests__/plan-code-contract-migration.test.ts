import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260828160000_make_plan_code_required/migration.sql",
  "utf8"
);

describe("Plan code contract migration (D3)", () => {
  it("declares code as non-nullable and unique in schema", () => {
    expect(schema).toMatch(/model Plan \{[\s\S]*?code\s+String\s+@unique/);
  });

  it("is structural-only and sets code NOT NULL without hardcoded data updates", () => {
    expect(migration).toContain('ALTER TABLE "plans" ALTER COLUMN "code" SET NOT NULL;');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP TABLE)\b/i);
    expect(migration).not.toContain('DROP INDEX "plans_code_key"');
    expect(migration).not.toContain("d4e9563f-fe5f-42ee-8577-d9c6136a6828");
    expect(migration).not.toContain("pro_monthly");
    expect(migration).not.toContain("founder_2026");
    expect(migration).not.toContain("tenant_subscriptions");
  });
});
