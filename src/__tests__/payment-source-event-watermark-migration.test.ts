import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260829140000_add_source_event_at_to_asaas_billing_payments/migration.sql",
  "utf8"
);

describe("AsaasBillingPayment sourceEventAt watermark migration (Phase 2.3A)", () => {
  it("declares sourceEventAt as nullable DateTime mapping to source_event_at in schema", () => {
    expect(schema).toMatch(
      /model AsaasBillingPayment \{[\s\S]*?sourceEventAt\s+DateTime\?\s+@map\("source_event_at"\)/
    );
  });

  it("is structural-only and adds nullable column source_event_at to asaas_billing_payments", () => {
    expect(migration).toContain(
      'ALTER TABLE "asaas_billing_payments" ADD COLUMN "source_event_at" TIMESTAMP(3);'
    );
    expect(migration).not.toMatch(/NOT NULL/i);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP|CREATE INDEX|UNIQUE|TRIGGER)\b/i);
    expect(migration).not.toContain("tenant_subscriptions");
    expect(migration).not.toContain("plans");
  });
});
