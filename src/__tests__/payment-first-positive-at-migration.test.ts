import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Phase 2.3C1 Migration: Add first_positive_at to asaas_billing_payments", () => {
  it("validates schema definition for firstPositiveAt in schema.prisma", () => {
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");

    expect(schemaContent).toContain('firstPositiveAt     DateTime?          @map("first_positive_at")');

    // Ensure no unexpected attributes like default, unique, or updatedAt
    const fieldLine = schemaContent
      .split("\n")
      .find((line) => line.includes("firstPositiveAt"));

    expect(fieldLine).toBeDefined();
    expect(fieldLine).not.toContain("@default");
    expect(fieldLine).not.toContain("@unique");
    expect(fieldLine).not.toContain("@updatedAt");
  });

  it("validates exact intended DDL SQL in migration file", () => {
    const migrationPath = path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260829210000_add_first_positive_at_to_asaas_billing_payments",
      "migration.sql"
    );

    expect(fs.existsSync(migrationPath)).toBe(true);
    const sqlContent = fs.readFileSync(migrationPath, "utf-8").trim();

    expect(sqlContent).toContain(
      'ALTER TABLE "asaas_billing_payments" ADD COLUMN "first_positive_at" TIMESTAMP(3);'
    );

    // Verify expand-only safety: zero DML, zero backfill, zero NOT NULL or DEFAULT constraints
    const upperSql = sqlContent.toUpperCase();
    expect(upperSql).not.toContain("UPDATE ");
    expect(upperSql).not.toContain("INSERT ");
    expect(upperSql).not.toContain("DELETE ");
    expect(upperSql).not.toContain("NOT NULL");
    expect(upperSql).not.toContain("DEFAULT");
    expect(upperSql).not.toContain("CREATE INDEX");
    expect(upperSql).not.toContain("CREATE UNIQUE");
  });
});
