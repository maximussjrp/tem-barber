import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("D1.1 Notification Delivery Assurance Schema & Migration Foundation", () => {
  const schemaPath = path.join(process.cwd(), "prisma/schema.prisma");
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");

  const schemaContent = fs.readFileSync(schemaPath, "utf8");

  // Find the new migration
  const migrationDirs = fs.readdirSync(migrationsDir).filter((d) =>
    d.endsWith("_add_notification_delivery_assurance")
  );
  expect(migrationDirs).toHaveLength(1);

  const migrationPath = path.join(migrationsDir, migrationDirs[0], "migration.sql");
  const migrationContent = fs.readFileSync(migrationPath, "utf8");

  it("1. PushDevice model exists in schema and table in migration", () => {
    expect(schemaContent).toContain("model PushDevice {");
    expect(schemaContent).toContain('@@map("push_devices")');
    expect(migrationContent).toContain('CREATE TABLE "push_devices"');
  });

  it("2. NotificationDelivery model exists in schema and table in migration", () => {
    expect(schemaContent).toContain("model NotificationDelivery {");
    expect(schemaContent).toContain('@@map("notification_deliveries")');
    expect(migrationContent).toContain('CREATE TABLE "notification_deliveries"');
  });

  it("3. two separate preference models exist (Global and Tenant) and no scopeKey in preferences", () => {
    expect(schemaContent).toContain("model GlobalNotificationPreference {");
    expect(schemaContent).toContain("model TenantNotificationPreference {");
    expect(migrationContent).toContain('CREATE TABLE "global_notification_preferences"');
    expect(migrationContent).toContain('CREATE TABLE "tenant_notification_preferences"');
    
    const globalMatch = schemaContent.match(/model GlobalNotificationPreference \{([\s\S]*?)\}/);
    const tenantMatch = schemaContent.match(/model TenantNotificationPreference \{([\s\S]*?)\}/);
    expect(globalMatch![1]).not.toContain("scopeKey");
    expect(tenantMatch![1]).not.toContain("scopeKey");
    expect(migrationContent).not.toContain("scope_key");
  });

  it("4. WebPushSubscription has nullable deviceId with unique constraint", () => {
    expect(schemaContent).toMatch(/deviceId\s+String\?\s+@unique\s+@map\("device_id"\)/);
    expect(migrationContent).toContain('ALTER TABLE "web_push_subscriptions" ADD COLUMN     "device_id" TEXT;');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX "web_push_subscriptions_device_id_key" ON "web_push_subscriptions"("device_id");');
  });

  it("5. PushDevice does NOT persist a canonical healthStatus field", () => {
    const pushDeviceMatch = schemaContent.match(/model PushDevice \{([\s\S]*?)\}/);
    expect(pushDeviceMatch).not.toBeNull();
    const pushDeviceBody = pushDeviceMatch![1];
    expect(pushDeviceBody).not.toContain("healthStatus");
    expect(migrationContent).not.toContain("health_status");
  });

  it("6. lastSeenAt and lastHealthCheckAt are nullable with no default in PushDevice", () => {
    const pushDeviceMatch = schemaContent.match(/model PushDevice \{([\s\S]*?)\}/);
    expect(pushDeviceMatch).not.toBeNull();
    const pushDeviceBody = pushDeviceMatch![1];
    expect(pushDeviceBody).toMatch(/lastSeenAt\s+DateTime\?\s+@map\("last_seen_at"\)/);
    expect(pushDeviceBody).toMatch(/lastHealthCheckAt\s+DateTime\?\s+@map\("last_health_check_at"\)/);
    expect(pushDeviceBody).not.toMatch(/lastSeenAt\s+DateTime\?\s+@default/);
    expect(pushDeviceBody).not.toMatch(/lastHealthCheckAt\s+DateTime\?\s+@default/);
    expect(migrationContent).toContain('"last_seen_at" TIMESTAMP(3),');
    expect(migrationContent).toContain('"last_health_check_at" TIMESTAMP(3),');
  });

  it("7. NotificationProviderStatus and NotificationCategory enums exist", () => {
    expect(schemaContent).toContain("enum NotificationProviderStatus {");
    expect(schemaContent).toContain("enum NotificationCategory {");
    expect(migrationContent).toContain('CREATE TYPE "NotificationProviderStatus" AS ENUM (\'PENDING\', \'ACCEPTED\', \'FAILED\', \'SKIPPED\');');
    expect(migrationContent).toContain('CREATE TYPE "NotificationCategory" AS ENUM (\'APPOINTMENT\', \'WAITLIST\', \'FINANCIAL\', \'SYSTEM\');');
  });

  it("8. NotificationDelivery device and subscription FKs use ON DELETE SET NULL", () => {
    expect(schemaContent).toMatch(/device\s+PushDevice\?\s+@relation\(fields: \[deviceId\], references: \[id\], onDelete: SetNull\)/);
    expect(schemaContent).toMatch(/subscription\s+WebPushSubscription\?\s+@relation\(fields: \[subscriptionId\], references: \[id\], onDelete: SetNull\)/);
    expect(migrationContent).toContain('ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "push_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;');
    expect(migrationContent).toContain('ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "web_push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;');
  });

  it("9. NotificationDelivery idempotencyKey is unique", () => {
    expect(schemaContent).toMatch(/idempotencyKey\s+String\s+@unique\s+@map\("idempotency_key"\)/);
    expect(migrationContent).toContain('CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");');
  });

  it("10. migration is expand-only and contains NO DML", () => {
    const lines = migrationContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (trimmed.startsWith("--")) continue;
      if (trimmed === "") continue;
      expect(trimmed).not.toMatch(/^INSERT\s+INTO/);
      expect(trimmed).not.toMatch(/^UPDATE\s+/);
      expect(trimmed).not.toMatch(/^DELETE\s+FROM/);
      expect(trimmed).not.toMatch(/^TRUNCATE\s+/);
      expect(trimmed).not.toMatch(/^DROP\s+TABLE/);
      expect(trimmed).not.toMatch(/^DROP\s+COLUMN/);
    }
  });

  it("11. PushDevice platform, browser, deviceClass, displayName are nullable with NO defaults", () => {
    const pushDeviceMatch = schemaContent.match(/model PushDevice \{([\s\S]*?)\}/);
    expect(pushDeviceMatch).not.toBeNull();
    const pushDeviceBody = pushDeviceMatch![1];
    
    expect(pushDeviceBody).toMatch(/platform\s+String\?/);
    expect(pushDeviceBody).toMatch(/browser\s+String\?/);
    expect(pushDeviceBody).toMatch(/deviceClass\s+String\?\s+@map\("device_class"\)/);
    expect(pushDeviceBody).toMatch(/displayName\s+String\?\s+@map\("display_name"\)/);

    expect(pushDeviceBody).not.toMatch(/platform\s+String\?\s+@default/);
    expect(pushDeviceBody).not.toMatch(/browser\s+String\?\s+@default/);
    expect(pushDeviceBody).not.toMatch(/deviceClass\s+String\?\s+@default/);
    expect(pushDeviceBody).not.toMatch(/displayName\s+String\?\s+@default/);

    expect(migrationContent).toContain('"platform" TEXT,');
    expect(migrationContent).toContain('"browser" TEXT,');
    expect(migrationContent).toContain('"device_class" TEXT,');
    expect(migrationContent).toContain('"display_name" TEXT,');

    expect(migrationContent).not.toMatch(/"platform"\s+TEXT\s+NOT\s+NULL/);
    expect(migrationContent).not.toMatch(/"browser"\s+TEXT\s+NOT\s+NULL/);
    expect(migrationContent).not.toMatch(/"device_class"\s+TEXT\s+NOT\s+NULL/);
    expect(migrationContent).not.toMatch(/"display_name"\s+TEXT\s+NOT\s+NULL/);
  });

  it("12. Redundant preference indexes removed, unique constraints preserved", () => {
    const globalMatch = schemaContent.match(/model GlobalNotificationPreference \{([\s\S]*?)\}/);
    const tenantMatch = schemaContent.match(/model TenantNotificationPreference \{([\s\S]*?)\}/);

    // Redundant indexes absent
    expect(globalMatch![1]).not.toContain("@@index([userId])");
    expect(tenantMatch![1]).not.toContain("@@index([userId, barbershopId])");

    expect(migrationContent).not.toContain("global_notification_preferences_user_id_idx");
    expect(migrationContent).not.toContain("tenant_notification_preferences_user_id_barbershop_id_idx");

    // Unique constraints preserved
    expect(globalMatch![1]).toContain("@@unique([userId, category])");
    expect(tenantMatch![1]).toContain("@@unique([userId, barbershopId, category])");

    expect(migrationContent).toContain('CREATE UNIQUE INDEX "global_notification_preferences_user_id_category_key" ON "global_notification_preferences"("user_id", "category");');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX "tenant_notification_preferences_user_id_barbershop_id_categ_key" ON "tenant_notification_preferences"("user_id", "barbershop_id", "category");');
  });
});
