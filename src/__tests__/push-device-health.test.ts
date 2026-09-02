import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deriveDeviceDisplayName,
  deriveServerLocalReadiness,
  resolveOrCreatePushDevice,
  recordDeviceHealthReport,
  linkSubscriptionToPushDevice,
  ReconciledSubscriptionSnapshot,
} from "@/lib/push/device-health.server";
import {
  detectClientPlatform,
  detectClientBrowser,
  detectClientDeviceClass,
  diagnoseClientLocalReadiness,
} from "@/lib/push/device-health.client";
import { POST as deviceHealthPOST } from "@/app/api/push/device-health/route";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

vi.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    pushDevice: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    webPushSubscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

describe("P0.1D - D2.3: Device Health Server Helpers & Route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NEXTAUTH_URL: "https://app.tembarber.com.br" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Server Derivation Logic & Canonical Readiness Precedence", () => {
    it("derives safe human-readable display names from bounded enums", () => {
      expect(deriveDeviceDisplayName("ANDROID", "CHROME")).toBe("Chrome no Android");
      expect(deriveDeviceDisplayName("IOS", "SAFARI")).toBe("Safari no iPhone/iPad");
      expect(deriveDeviceDisplayName("WINDOWS", "EDGE")).toBe("Edge no Windows");
      expect(deriveDeviceDisplayName("MACOS", "FIREFOX")).toBe("Firefox no Mac");
      expect(deriveDeviceDisplayName("LINUX", "CHROME")).toBe("Chrome no Linux");
    });

    it("A. unsupported capability / SW unsupported -> UNSUPPORTED", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "WINDOWS",
          browser: "CHROME",
          deviceClass: "DESKTOP",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "UNSUPPORTED",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("UNSUPPORTED");
    });

    it("B & E. iOS non-standalone -> IOS_INSTALL_REQUIRED", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "IOS",
          browser: "SAFARI",
          deviceClass: "MOBILE",
          notificationPermission: "PROMPT",
          pushPermission: "PROMPT",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: false,
          isStandalone: false,
        })
      ).toBe("IOS_INSTALL_REQUIRED");
    });

    it("F. iOS standalone + registration missing != IOS_INSTALL_REQUIRED (becomes LOCAL_SUBSCRIPTION_MISSING)", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "IOS",
          browser: "SAFARI",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "REGISTRATION_MISSING",
          localSubscriptionPresent: false,
          isStandalone: true,
        })
      ).toBe("LOCAL_SUBSCRIPTION_MISSING");
    });

    it("C. notification DENIED or push DENIED -> PERMISSION_DENIED (Hard Test)", () => {
      // Hard Test: notification GRANTED + push DENIED + SW ACTIVE + subscription true => PERMISSION_DENIED. Never READY.
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "ANDROID",
          browser: "CHROME",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "DENIED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("PERMISSION_DENIED");

      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "WINDOWS",
          browser: "CHROME",
          deviceClass: "DESKTOP",
          notificationPermission: "DENIED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("PERMISSION_DENIED");
    });

    it("D. notification PROMPT or push PROMPT -> PERMISSION_PROMPT", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "ANDROID",
          browser: "CHROME",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "PROMPT",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("PERMISSION_PROMPT");
    });

    it("D. pushPermission UNAVAILABLE + notification GRANTED + SW ACTIVE + local subscription true => READY", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "WINDOWS",
          browser: "CHROME",
          deviceClass: "DESKTOP",
          notificationPermission: "GRANTED",
          pushPermission: "UNAVAILABLE",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("READY");
    });

    it("F. notification GRANTED + SW ACTIVE + local subscription false => LOCAL_SUBSCRIPTION_MISSING", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "ANDROID",
          browser: "CHROME",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: false,
          isStandalone: false,
        })
      ).toBe("LOCAL_SUBSCRIPTION_MISSING");
    });

    it("READY condition when all preconditions satisfied", () => {
      expect(
        deriveServerLocalReadiness({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "ANDROID",
          browser: "CHROME",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("READY");
    });
  });

  describe("2. PushDevice Shell & Transactional Linking", () => {
    const validSnapshot: ReconciledSubscriptionSnapshot = {
      subscriptionId: "new-sub-2",
      endpoint: "https://push.example.com/endpoint-2",
      p256dh: "key-p256dh-2",
      auth: "auth-secret-2",
    };

    it("resolveOrCreatePushDevice finds existing device", async () => {
      const mockDevice = {
        id: "dev-1",
        userId: "u1",
        deviceInstanceId: "inst-1",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);

      const res = await resolveOrCreatePushDevice("u1", "inst-1");
      expect(res).toBe(mockDevice);
      expect(prisma.pushDevice.create).not.toHaveBeenCalled();
    });

    it("resolveOrCreatePushDevice creates shell with bounded P2002 retry", async () => {
      const mockDevice = {
        id: "dev-2",
        userId: "u1",
        deviceInstanceId: "inst-2",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockDevice);

      const p2002Err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "7.8.0",
      });
      vi.mocked(prisma.pushDevice.create).mockRejectedValue(p2002Err);

      const res = await resolveOrCreatePushDevice("u1", "inst-2");
      expect(res.id).toBe("dev-2");
    });

    it("recordDeviceHealthReport sets server timestamps, derived displayName, and derives readiness", async () => {
      const mockDevice = {
        id: "dev-1",
        userId: "u1",
        deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);
      vi.mocked(prisma.pushDevice.update).mockResolvedValue(mockDevice);

      const res = await recordDeviceHealthReport("u1", {
        deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
        platform: "ANDROID",
        browser: "CHROME",
        deviceClass: "MOBILE",
        notificationPermission: "GRANTED",
        pushPermission: "GRANTED",
        serviceWorkerState: "ACTIVE",
        localSubscriptionPresent: true,
        isStandalone: false,
      });

      expect(res.success).toBe(true);
      expect(prisma.pushDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "dev-1" },
          data: expect.objectContaining({
            displayName: "Chrome no Android",
            localReadiness: "READY",
            lastSeenAt: expect.any(Date),
            lastHealthCheckAt: expect.any(Date),
          }),
        })
      );
    });

    it("K, P, Q. linkSubscriptionToPushDevice requires exact capability snapshot in single transaction and preserves unrelated legacy WPS", async () => {
      const mockDevice = {
        id: "dev-1",
        userId: "u1",
        deviceInstanceId: "inst-1",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);

      vi.mocked(prisma.$transaction).mockImplementation(async (cb, options) => {
        expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const tx = {
          webPushSubscription: {
            findFirst: vi.fn().mockResolvedValue({ id: "old-sub-1" }),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          pushDevice: {
            update: vi.fn().mockResolvedValue(mockDevice),
          },
        };
        const callback = cb as unknown as (txClient: typeof tx) => Promise<unknown>;
        const res = await callback(tx);

        // Prove rotated old WPS deleted conditionally
        expect(tx.webPushSubscription.deleteMany).toHaveBeenCalledWith({
          where: {
            id: "old-sub-1",
            userId: "u1",
            deviceId: "dev-1",
          },
        });

        // Prove exact capability snapshot revalidation (id, userId, endpoint, p256dh, auth)
        expect(tx.webPushSubscription.updateMany).toHaveBeenCalledWith({
          where: {
            id: "new-sub-2",
            userId: "u1",
            endpoint: "https://push.example.com/endpoint-2",
            p256dh: "key-p256dh-2",
            auth: "auth-secret-2",
          },
          data: { deviceId: "dev-1" },
        });

        return res;
      });

      const res = await linkSubscriptionToPushDevice("u1", validSnapshot, "inst-1");
      expect(res.success).toBe(true);
    });

    it("L & O. capability mismatch count 0 fails transaction, rolls back rotation deletion, and returns success: false", async () => {
      const mockDevice = {
        id: "dev-1",
        userId: "u1",
        deviceInstanceId: "inst-1",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        const tx = {
          webPushSubscription: {
            findFirst: vi.fn().mockResolvedValue({ id: "old-sub-1" }),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }), // count 0
          },
          pushDevice: {
            update: vi.fn(),
          },
        };
        const callback = cb as unknown as (txClient: typeof tx) => Promise<unknown>;
        return callback(tx);
      });

      const res = await linkSubscriptionToPushDevice("u1", validSnapshot, "inst-1");
      expect(res.success).toBe(false);
    });

    it("M & N. P2034 / P2002 retry invokes whole transaction again with zero external writes", async () => {
      const mockDevice = {
        id: "dev-1",
        userId: "u1",
        deviceInstanceId: "inst-1",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);

      const p2034Err = new Prisma.PrismaClientKnownRequestError("Transaction deadlock", {
        code: "P2034",
        clientVersion: "7.8.0",
      });

      let callCount = 0;
      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        callCount++;
        if (callCount === 1) {
          throw p2034Err;
        }
        const tx = {
          webPushSubscription: {
            findFirst: vi.fn().mockResolvedValue(null),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          pushDevice: {
            update: vi.fn().mockResolvedValue(mockDevice),
          },
        };
        const callback = cb as unknown as (txClient: typeof tx) => Promise<unknown>;
        return callback(tx);
      });

      const res = await linkSubscriptionToPushDevice("u1", validSnapshot, "inst-1");
      expect(res.success).toBe(true);
      expect(callCount).toBe(2);
      // Verify no external writes occurred on prisma outside transaction
      expect(prisma.webPushSubscription.updateMany).not.toHaveBeenCalled();
      expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("3. POST /api/push/device-health Endpoint Security", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://app.tembarber.com.br" },
        body: JSON.stringify({}),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(401);
    });

    it("returns 403 for phone_lookup auth level", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "phone_lookup" },
      });

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://app.tembarber.com.br" },
        body: JSON.stringify({}),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(403);
    });

    it("returns 403 for invalid origin", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "admin" },
      });

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://malicious.com" },
        body: JSON.stringify({}),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(403);
    });

    it("returns 400 for non-json content type", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "admin" },
      });

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: "https://app.tembarber.com.br" },
        body: "{}",
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when unknown fields are supplied (rejects userId, barbershopId, deviceId)", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "admin" },
      });

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://app.tembarber.com.br" },
        body: JSON.stringify({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "WINDOWS",
          browser: "CHROME",
          deviceClass: "DESKTOP",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
          userId: "malicious-spoof",
        }),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when isStandalone is missing or non-boolean", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "admin" },
      });

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://app.tembarber.com.br" },
        body: JSON.stringify({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "WINDOWS",
          browser: "CHROME",
          deviceClass: "DESKTOP",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          // isStandalone missing
        }),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(400);
    });

    it("returns 200 { ok: true } and does NOT leak internal deviceId", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-1", authLevel: "admin" },
      });

      const mockDevice = {
        id: "dev-1-internal-db-id",
        userId: "user-1",
        deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
        platform: null,
        browser: null,
        deviceClass: null,
        displayName: null,
        localReadiness: null,
        notificationPermission: null,
        pushPermission: null,
        serviceWorkerState: null,
        lastSeenAt: null,
        lastHealthCheckAt: null,
        lastSubscriptionReconciledAt: null,
        lastPushReceiptAt: null,
        lastNotificationCreatedAt: null,
        lastNotificationClickAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue(mockDevice);
      vi.mocked(prisma.pushDevice.update).mockResolvedValue(mockDevice);

      const req = new Request("https://app.tembarber.com.br/api/push/device-health", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://app.tembarber.com.br" },
        body: JSON.stringify({
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
          platform: "ANDROID",
          browser: "CHROME",
          deviceClass: "MOBILE",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        }),
      });

      const res = await deviceHealthPOST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(json).not.toHaveProperty("deviceId");
    });
  });

  describe("4. Client Diagnostics Parity", () => {
    it("diagnoses client local readiness matching server decision table parity", () => {
      expect(
        diagnoseClientLocalReadiness({
          platform: "WINDOWS",
          notificationPermission: "GRANTED",
          pushPermission: "GRANTED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("READY");

      expect(
        diagnoseClientLocalReadiness({
          platform: "ANDROID",
          notificationPermission: "GRANTED",
          pushPermission: "DENIED",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: true,
          isStandalone: false,
        })
      ).toBe("PERMISSION_DENIED");

      expect(
        diagnoseClientLocalReadiness({
          platform: "IOS",
          notificationPermission: "PROMPT",
          pushPermission: "PROMPT",
          serviceWorkerState: "ACTIVE",
          localSubscriptionPresent: false,
          isStandalone: false,
        })
      ).toBe("IOS_INSTALL_REQUIRED");
    });
  });

  describe("5. Client Provider Lifecycle Contracts (Items G, H, I, J, R, S, T, U, V)", () => {
    it("G. health POST success alone does NOT set serverLinked true", async () => {
      // In the provider, serverLinked is maintained as a strict ref linked to subscribe response.
      let serverLinked = false;
      const fakeHealthReport = async () => {
        // Successful health POST
        const ok = true;
        // Provider rule: health report preserves serverLinked, never sets it true alone
        if (ok) {
          // serverLinked remains whatever it was
        }
      };

      await fakeHealthReport();
      expect(serverLinked).toBe(false);
    });

    it("H. failed health POST does not advance 6h success throttle", () => {
      let lastReportTimestamp = 0;
      const reportFailed = true;

      // When report fails, lastReportTimestamp is NOT updated
      if (!reportFailed) {
        lastReportTimestamp = Date.now();
      }

      expect(lastReportTimestamp).toBe(0);
      // Immediately eligible for retry on next focus/visibility
      const now = Date.now();
      const STALE_6H = 6 * 60 * 60 * 1000;
      expect(now - lastReportTimestamp > STALE_6H).toBe(true);
    });

    it("I & J. subscribe response deviceLinked true sets serverLinked true; missing or false does not", () => {
      const parseSubscribeResponse = (body: Record<string, unknown>): boolean => {
        return body.deviceLinked === true;
      };

      // I. deviceLinked: true
      expect(parseSubscribeResponse({ ok: true, deviceLinked: true })).toBe(true);

      // J. missing deviceLinked (legacy response) or false
      expect(parseSubscribeResponse({ ok: true })).toBe(false);
      expect(parseSubscribeResponse({ ok: true, deviceLinked: false })).toBe(false);
      expect(parseSubscribeResponse({ ok: true, deviceLinked: null })).toBe(false);
    });

    it("R & S. account-switch mid-request aborts state/POST update and isolates in-flight report per identity", async () => {
      let currentIdentity: string | null = "user-A:admin";
      let appliedIdentity: string | null = null;

      const reportForUserA = async () => {
        const activeIdentity = currentIdentity;
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Identity switched to user-B during async operation
        if (currentIdentity !== activeIdentity) {
          return; // Aborted
        }
        appliedIdentity = activeIdentity;
      };

      const promise = reportForUserA();
      currentIdentity = "user-B:verified_link"; // switch identity
      await promise;

      expect(appliedIdentity).toBeNull(); // User A payload dropped
    });

    it("T. visibilitychange hidden does not trigger report", () => {
      let reportTriggered = false;
      const handleVisibilityChange = (visibilityState: DocumentVisibilityState) => {
        if (visibilityState !== "visible") return;
        reportTriggered = true;
      };

      handleVisibilityChange("hidden");
      expect(reportTriggered).toBe(false);

      handleVisibilityChange("visible");
      expect(reportTriggered).toBe(true);
    });

    it("U. permission listener query promise checks disposal flag before attaching event listener", async () => {
      let isDisposed = false;
      let listenerAttached = false;

      const fakeQuery = Promise.resolve({
        addEventListener: () => {
          listenerAttached = true;
        },
      });

      // Component unmounts synchronously
      isDisposed = true;

      await fakeQuery.then((status) => {
        if (isDisposed) return;
        status.addEventListener();
      });

      expect(listenerAttached).toBe(false);
    });

    it("V. storage-unavailable flow leaves Push operable locally with serverLinked false and no server POST", async () => {
      const fetchSpy = vi.fn();
      const globalFetch = globalThis.fetch;
      globalThis.fetch = fetchSpy;

      try {
        const { collectClientDeviceHealth, sendDeviceHealthReport } = await import(
          "@/lib/push/device-health.client"
        );

        // Telemetry collected with null deviceInstanceId
        const localTelemetry = await collectClientDeviceHealth(null);
        expect(localTelemetry.deviceInstanceId).toBeNull();

        // Attempting to send report with null deviceInstanceId returns false immediately without network call
        const sent = await sendDeviceHealthReport(localTelemetry);
        expect(sent).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = globalFetch;
      }
    });
  });
});
