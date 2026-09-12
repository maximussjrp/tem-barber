import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Meta Coexistence Schema & Migration Tests", () => {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  const schemaContent = fs.readFileSync(schemaPath, "utf8");

  it("contains MetaConnectionMode enum with COEXISTENCE and CLOUD_API_ONLY", () => {
    expect(schemaContent).toContain("enum MetaConnectionMode {");
    expect(schemaContent).toContain("COEXISTENCE");
    expect(schemaContent).toContain("CLOUD_API_ONLY");
  });

  it("contains connectionMode field on MetaConnection defaulting to COEXISTENCE", () => {
    expect(schemaContent).toMatch(
      /connectionMode\s+MetaConnectionMode\s+@default\(COEXISTENCE\)\s+@map\("connection_mode"\)/
    );
  });

  it("preserves unique and index constraints on MetaConnection", () => {
    expect(schemaContent).toMatch(
      /barbershopId\s+String\s+@unique\s+@map\("barbershop_id"\)/
    );
    expect(schemaContent).toMatch(
      /phoneNumberId\s+String\?\s+@unique\s+@map\("phone_number_id"\)/
    );
    expect(schemaContent).toContain("@@index([wabaId])");
  });

  it("includes all lifecycle events in MetaConnectionEventType", () => {
    expect(schemaContent).toContain("ONBOARDING_STARTED");
    expect(schemaContent).toContain("ONBOARDING_COMPLETED");
    expect(schemaContent).toContain("ONBOARDING_FAILED");
    expect(schemaContent).toContain("ASSETS_DISCOVERED");
    expect(schemaContent).toContain("SYSTEM_USER_ASSIGNED");
    expect(schemaContent).toContain("WEBHOOK_SUBSCRIBED");
    expect(schemaContent).toContain("CONNECTED");
    expect(schemaContent).toContain("DEGRADED");
    expect(schemaContent).toContain("DISCONNECTED");
    expect(schemaContent).toContain("RECONNECTED");
  });

  it("ensures exactly one additive migration exists for R6.1B", () => {
    const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
    const migrationDirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory());

    const r61bMigrations = migrationDirs.filter((d) =>
      d.includes("add_meta_coexistence_foundation")
    );

    expect(r61bMigrations).toHaveLength(1);

    const [r61bMigration] = r61bMigrations;

    const sqlContent = fs.readFileSync(
      path.join(migrationsDir, r61bMigration!, "migration.sql"),
      "utf8"
    );

    // Additive checks: no DROP, no destructive ALTER
    expect(sqlContent).not.toMatch(/DROP\s+TABLE/i);
    expect(sqlContent).not.toMatch(/DROP\s+COLUMN/i);
    expect(sqlContent).toContain('CREATE TYPE "MetaConnectionMode"');
    expect(sqlContent).toContain('ALTER TABLE "meta_connections" ADD COLUMN "connection_mode"');
  });
});
