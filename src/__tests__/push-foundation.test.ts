import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateVapidSubject, parseVapidConfig } from "../lib/push/vapid-config";
import fs from "fs";
import path from "path";

describe("P0.1A Push Foundation & VAPID Config Security", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("1. Pure validation accepts valid HTTPS URL", () => {
    expect(validateVapidSubject("https://app.tembarber.com.br")).toBe(true);
    expect(validateVapidSubject("https://example.com/push")).toBe(true);
  });

  it("2. Pure validation accepts valid mailto URI", () => {
    expect(validateVapidSubject("mailto:suporte@tembarber.com.br")).toBe(true);
  });

  it("3. Rejects empty, null, or undefined subject", () => {
    expect(validateVapidSubject("")).toBe(false);
    expect(validateVapidSubject("   ")).toBe(false);
    expect(validateVapidSubject(null)).toBe(false);
    expect(validateVapidSubject(undefined)).toBe(false);
  });

  it("4. Rejects HTTP scheme", () => {
    expect(validateVapidSubject("http://app.tembarber.com.br")).toBe(false);
  });

  it("5. Rejects FTP scheme", () => {
    expect(validateVapidSubject("ftp://app.tembarber.com.br")).toBe(false);
  });

  it("6. Rejects javascript scheme", () => {
    expect(validateVapidSubject("javascript:alert(1)")).toBe(false);
  });

  it("7. Rejects bare https:// without host", () => {
    expect(validateVapidSubject("https://")).toBe(false);
  });

  it("8. Rejects bare mailto: without recipient", () => {
    expect(validateVapidSubject("mailto:")).toBe(false);
    expect(validateVapidSubject("mailto:   ")).toBe(false);
  });

  it("9. Missing VAPID_PUBLIC_KEY rejected when runtime config requested", () => {
    expect(() =>
      parseVapidConfig({
        publicKey: "",
        privateKey: "priv_123",
        subject: "https://app.tembarber.com.br",
      })
    ).toThrow("VAPID_PUBLIC_KEY configuration is missing.");
  });

  it("10. Missing VAPID_PRIVATE_KEY rejected when runtime config requested", () => {
    expect(() =>
      parseVapidConfig({
        publicKey: "pub_123",
        privateKey: "",
        subject: "https://app.tembarber.com.br",
      })
    ).toThrow("VAPID_PRIVATE_KEY configuration is missing.");
  });

  it("11. Missing VAPID_SUBJECT rejected when runtime config requested", () => {
    expect(() =>
      parseVapidConfig({
        publicKey: "pub_123",
        privateKey: "priv_123",
        subject: "",
      })
    ).toThrow("VAPID_SUBJECT configuration is missing.");
  });

  it("12. Server adapter web-push.server.ts contains import 'server-only' marker for Next.js security boundary", () => {
    const serverFilePath = path.resolve(__dirname, "../lib/push/web-push.server.ts");
    const serverFileContent = fs.readFileSync(serverFilePath, "utf-8");

    // Must start with exact import "server-only"; at line 1
    const firstLine = serverFileContent.split("\n")[0].trim();
    expect(firstLine).toBe('import "server-only";');
  });

  it("13. No source file contains NEXT_PUBLIC_VAPID_PRIVATE_KEY", () => {
    const forbiddenToken = "NEXT_PUBLIC_" + "VAPID_PRIVATE_KEY";
    const srcDir = path.resolve(__dirname, "..");
    const searchFile = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchFile(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content).not.toContain(forbiddenToken);
        }
      }
    };
    searchFile(srcDir);
  });

  it("14. Schema foundation contains WebPushSubscription and expanded Notification models", async () => {
    const prismaModule = await import("../lib/prisma");
    const prisma = prismaModule.default;

    expect(prisma.webPushSubscription).toBeDefined();
    expect(prisma.notification).toBeDefined();
  });

  it("15. No console output includes the private key during parsing or helper operations", () => {
    const spyLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const spyError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const secretPrivKey = "SUPER_SECRET_PRIVATE_KEY_123987";
      const config = parseVapidConfig({
        publicKey: "pub_key",
        privateKey: secretPrivKey,
        subject: "https://app.tembarber.com.br",
      });

      expect(config.privateKey).toBe(secretPrivKey);

      const allLogged = [...spyLog.mock.calls, ...spyError.mock.calls].flat().join(" ");
      expect(allLogged).not.toContain(secretPrivKey);
    } finally {
      spyLog.mockRestore();
      spyError.mockRestore();
    }
  });
});
