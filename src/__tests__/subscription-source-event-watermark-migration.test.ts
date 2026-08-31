import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260831150000_add_subscription_source_event_watermarks/migration.sql",
  "utf8"
);

describe("AsaasBillingSubscription source event watermarks migration (Phase 2.3D1A)", () => {
  it("declares sourceEventAt and sourceEventId as nullable fields mapping to source_event_at and source_event_id in schema without default/unique/index", () => {
    expect(schema).toMatch(
      /model AsaasBillingSubscription \{[\s\S]*?sourceEventAt\s+DateTime\?\s+@map\("source_event_at"\)\s+@db\.Timestamp\(3\)/
    );
    expect(schema).toMatch(
      /model AsaasBillingSubscription \{[\s\S]*?sourceEventId\s+String\?\s+@map\("source_event_id"\)/
    );

    const modelMatch = schema.match(/model AsaasBillingSubscription \{([\s\S]*?)\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelContent = modelMatch![1];

    expect(modelContent).not.toMatch(/sourceEventAt.*@unique/);
    expect(modelContent).not.toMatch(/sourceEventAt.*@default/);
    expect(modelContent).not.toMatch(/sourceEventId.*@unique/);
    expect(modelContent).not.toMatch(/sourceEventId.*@default/);
    expect(modelContent).not.toMatch(/@@index\(\[.*sourceEventAt.*\]\)/);
    expect(modelContent).not.toMatch(/@@index\(\[.*sourceEventId.*\]\)/);
  });

  it("is expand-only and adds nullable columns source_event_at and source_event_id to asaas_billing_subscriptions", () => {
    expect(migration).toContain(
      'ALTER TABLE "asaas_billing_subscriptions" ADD COLUMN     "source_event_at" TIMESTAMP(3),'
    );
    expect(migration).toContain(
      'ADD COLUMN     "source_event_id" TEXT;'
    );
    expect(migration).not.toMatch(/NOT NULL/i);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP|CREATE INDEX|UNIQUE|TRIGGER|FOREIGN KEY)\b/i);
    expect(migration).not.toContain("tenant_subscriptions");
    expect(migration).not.toContain("plans");
    expect(migration).not.toContain("asaas_billing_payments");
  });
});
