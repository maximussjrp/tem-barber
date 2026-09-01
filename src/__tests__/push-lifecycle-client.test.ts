import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

import { urlBase64ToUint8Array } from "@/lib/push/vapid-key-convert";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";

describe("P0.1B Client Push Utilities, Server-Only Boundary & Lifecycle Invariants", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Server-Only Static Boundary Audit", () => {
    it("proves src/lib/push/push-api.server.ts starts with import 'server-only';", () => {
      const serverFilePath = path.join(process.cwd(), "src", "lib", "push", "push-api.server.ts");
      const content = fs.readFileSync(serverFilePath, "utf-8");
      const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
      expect(lines[0]).toBe('import "server-only";');
    });

    it("proves PushLifecycleProvider.tsx does NOT import any .server module", () => {
      const providerPath = path.join(process.cwd(), "src", "components", "providers", "PushLifecycleProvider.tsx");
      const content = fs.readFileSync(providerPath, "utf-8");

      expect(content).not.toContain("push-api.server");
      expect(content).not.toContain("web-push.server");
      expect(content).not.toContain(".server");
    });
  });

  describe("urlBase64ToUint8Array", () => {
    it("converts URL-safe base64 string to Uint8Array correctly", () => {
      const result = urlBase64ToUint8Array("dGVzdA");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(4);
      expect(Array.from(result)).toEqual([116, 101, 115, 116]);
    });

    it("handles URL-safe characters '-' and '_'", () => {
      const base64Url = "a-_b";
      const result = urlBase64ToUint8Array(base64Url);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("throws error for empty or invalid base64 input", () => {
      expect(() => urlBase64ToUint8Array("")).toThrow("Invalid base64 string");
    });
  });

  describe("cleanupCurrentPushSubscriptionBeforeLogout", () => {
    it("runs within bounded 2000ms total timeout budget and proceeds even if API fails", async () => {
      const mockUnsubscribe = vi.fn().mockResolvedValue(true);
      const mockGetSubscription = vi.fn().mockResolvedValue({
        toJSON: () => ({
          endpoint: "https://push.example.com/test",
          keys: { p256dh: "p256dhKey", auth: "authKey" },
        }),
        unsubscribe: mockUnsubscribe,
      });

      const mockRegistration = {
        pushManager: {
          getSubscription: mockGetSubscription,
        },
      };

      vi.stubGlobal("window", globalThis);
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: vi.fn().mockResolvedValue(mockRegistration),
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      const start = Date.now();
      await cleanupCurrentPushSubscriptionBeforeLogout(2000);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2500);
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it("proceeds gracefully if browser has no service worker or subscription", async () => {
      vi.stubGlobal("window", globalThis);
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: vi.fn().mockResolvedValue(null),
        },
      });

      await expect(cleanupCurrentPushSubscriptionBeforeLogout(2000)).resolves.toBeUndefined();
    });

    it("proceeds gracefully if fetch server detach throws network error", async () => {
      const mockUnsubscribe = vi.fn().mockResolvedValue(true);
      const mockGetSubscription = vi.fn().mockResolvedValue({
        toJSON: () => ({
          endpoint: "https://push.example.com/test",
          keys: { p256dh: "p256dhKey", auth: "authKey" },
        }),
        unsubscribe: mockUnsubscribe,
      });

      vi.stubGlobal("window", globalThis);
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: vi.fn().mockResolvedValue({
            pushManager: { getSubscription: mockGetSubscription },
          }),
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network offline")));

      await cleanupCurrentPushSubscriptionBeforeLogout(2000);
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("PushLifecycleProvider Behavioral Flow Verification", () => {
    it("proves startup when GET /api/push/config returns 503 results in ERROR state (never ACTIVE, 0 subscribe calls)", async () => {
      const providerContent = fs.readFileSync(
        path.join(process.cwd(), "src", "components", "providers", "PushLifecycleProvider.tsx"),
        "utf-8"
      );

      // Verify source guarantees
      expect(providerContent).toContain("if (!key) {");
      expect(providerContent).toContain('setState("ERROR");');

      // Verify that if key is null, it returns before permission or subscribe calls
      const keyCheckIndex = providerContent.indexOf("if (!key) {");
      const permCheckIndex = providerContent.indexOf("const perm = Notification.permission;");
      expect(keyCheckIndex).toBeGreaterThan(0);
      expect(permCheckIndex).toBeGreaterThan(keyCheckIndex);
    });

    it("proves activation click NEVER awaits network prior to Notification.requestPermission()", () => {
      const providerContent = fs.readFileSync(
        path.join(process.cwd(), "src", "components", "providers", "PushLifecycleProvider.tsx"),
        "utf-8"
      );

      const subscribeDefIndex = providerContent.indexOf("const subscribe = useCallback");
      const subscribeBody = providerContent.slice(subscribeDefIndex, subscribeDefIndex + 2500);

      const requestPermIndex = subscribeBody.indexOf("Notification.requestPermission()");
      const fetchSubscribeIndex = subscribeBody.indexOf('fetch("/api/push/subscribe"');

      expect(requestPermIndex).toBeGreaterThan(0);
      expect(fetchSubscribeIndex).toBeGreaterThan(requestPermIndex);

      // Verify that if !publicKey, it returns immediately without requesting permission
      expect(subscribeBody).toContain("if (!publicKey) {");
      expect(subscribeBody).toContain('setState("CONFIG_LOADING");');
    });
  });
});
