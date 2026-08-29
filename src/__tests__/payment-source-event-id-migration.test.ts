import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260829160000_add_source_event_id_to_asaas_billing_payments/migration.sql",
  "utf8"
);

describe("AsaasBillingPayment sourceEventId watermark migration (Phase 2.3B1)", () => {
  it("declares sourceEventId as nullable String mapping to source_event_id in schema without default/unique/index", () => {
    expect(schema).toMatch(
      /model AsaasBillingPayment \{[\s\S]*?sourceEventId\s+String\?\s+@map\("source_event_id"\)/
    );

    const modelMatch = schema.match(/model AsaasBillingPayment \{([\s\S]*?)\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelContent = modelMatch![1];

    expect(modelContent).not.toMatch(/sourceEventId.*@unique/);
    expect(modelContent).not.toMatch(/sourceEventId.*@default/);
    expect(modelContent).not.toMatch(/@@index\(\[.*sourceEventId.*\]\)/);
  });

  it("is structural-only and adds nullable column source_event_id to asaas_billing_payments", () => {
    expect(migration).toContain(
      'ALTER TABLE "asaas_billing_payments" ADD COLUMN "source_event_id" TEXT;'
    );
    expect(migration).not.toMatch(/NOT NULL/i);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP|CREATE INDEX|UNIQUE|TRIGGER|FOREIGN KEY)\b/i);
    expect(migration).not.toContain("tenant_subscriptions");
    expect(migration).not.toContain("plans");
  });
});
