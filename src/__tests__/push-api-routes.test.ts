import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getConfig } from "@/app/api/push/config/route";
import { POST as subscribe } from "@/app/api/push/subscribe/route";
import { DELETE as unsubscribe } from "@/app/api/push/unsubscribe/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { configureWebPush, getVapidConfig } from "@/lib/push/web-push.server";
import { isPrismaP2002Error } from "@/lib/push/push-api.server";
import { parseSubscribeBody } from "@/lib/push/subscription-payload";
import { Prisma } from "@prisma/client";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/push/web-push.server", () => ({
  configureWebPush: vi.fn(),
  getVapidConfig: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webPushSubscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    pushDevice: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("P0.1B Push API Routes & Server Mechanics", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.NEXTAUTH_URL = "https://app.tembarber.com.br";
    vi.mocked(configureWebPush).mockReturnValue({} as never);
    vi.mocked(getVapidConfig).mockReturnValue({
      publicKey: "BNb_validPublicKeyBase64UrlStringWithoutDots",
      privateKey: "validPrivateKeyBase64UrlStringWithoutDots",
      subject: "https://app.tembarber.com.br",
    });
  });

  describe("Prisma P2002 Type Checker Helper", () => {
    it("correctly identifies PrismaClientKnownRequestError with P2002 code", () => {
      const p2002Err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
      });
      expect(isPrismaP2002Error(p2002Err)).toBe(true);
    });

    it("rejects generic Error, arbitrary objects, or fake duck-typed objects with code P2002", () => {
      expect(isPrismaP2002Error(new Error("Generic error"))).toBe(false);
      expect(isPrismaP2002Error({ code: "P2002" })).toBe(false);
      expect(isPrismaP2002Error({ name: "PrismaClientKnownRequestError", code: "P2002" })).toBe(false);
      expect(isPrismaP2002Error(null)).toBe(false);
    });
  });

  describe("GET /api/push/config", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce(null);

      const res = await getConfig();
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toEqual({ error: "UNAUTHORIZED" });
    });

    it("returns 403 for phone_lookup authLevel", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "cust-1", authLevel: "phone_lookup" },
      });

      const res = await getConfig();
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data).toEqual({ error: "PUSH_AUTH_LEVEL_NOT_ELIGIBLE" });
    });

    it("returns public key for admin, verified_link, and verified_otp authLevels", async () => {
      const eligibleLevels = ["admin", "verified_link", "verified_otp"];
      for (const authLevel of eligibleLevels) {
        vi.mocked(getServerSession).mockResolvedValueOnce({
          user: { id: "user-1", authLevel },
        });

        const res = await getConfig();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ publicKey: "BNb_validPublicKeyBase64UrlStringWithoutDots" });
        expect(data).not.toHaveProperty("privateKey");
        expect(data).not.toHaveProperty("subject");
      }
    });

    it("returns 503 when VAPID configuration is missing", async () => {
      vi.mocked(configureWebPush).mockImplementationOnce(() => {
        throw new Error("VAPID_PUBLIC_KEY configuration is missing.");
      });

      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      const res = await getConfig();
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data).toEqual({ error: "PUSH_NOT_CONFIGURED" });
    });
  });

  describe("POST /api/push/subscribe", () => {
    const validBody = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
      expirationTime: null,
      keys: {
        p256dh: "BEl62iUYgUivxIkv69yViEuiBIa_validBase64Url",
        auth: "5r541t_authKeyBase64Url",
      },
    };

    const makeRequest = (body: unknown, headers: Record<string, string> = {}) => {
      return new Request("https://app.tembarber.com.br/api/push/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.tembarber.com.br",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    };

    it("accepts application/json; charset=utf-8 and rejects application/jsonx with 400", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "admin-1", authLevel: "admin" },
      });
      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.webPushSubscription.create).mockResolvedValue({ id: "sub-created-1" } as never);

      // Accepted parameter
      const validMediaReq = makeRequest(validBody, { "content-type": "application/json; charset=utf-8" });
      const validRes = await subscribe(validMediaReq);
      expect(validRes.status).toBe(200);

      // Rejected media type
      const invalidMediaReq = makeRequest(validBody, { "content-type": "application/jsonx" });
      const invalidRes = await subscribe(invalidMediaReq);
      expect(invalidRes.status).toBe(400);
      const invalidData = await invalidRes.json();
      expect(invalidData).toEqual({ error: "INVALID_REQUEST" });
    });

    it("returns 500 INTERNAL_ERROR when NEXTAUTH_URL environment variable is invalid", async () => {
      process.env.NEXTAUTH_URL = "not-a-valid-url";
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: "INTERNAL_ERROR" });
    });

    it("rejects Host/X-Forwarded-Host overrides and enforces canonical NEXTAUTH_URL origin", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      const spoofedReq = makeRequest(validBody, {
        origin: "https://malicious-domain.com",
        host: "app.tembarber.com.br",
        "x-forwarded-host": "app.tembarber.com.br",
      });

      const res = await subscribe(spoofedReq);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data).toEqual({ error: "ORIGIN_NOT_ALLOWED" });
    });

    it("rejects nested extra keys (keys.userId or keys.foo) with 400 INVALID_REQUEST", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "admin-1", authLevel: "admin" },
      });

      const extraNestedKeyBody = {
        ...validBody,
        keys: {
          ...validBody.keys,
          userId: "attacker-user-id",
        },
      };

      const res = await subscribe(makeRequest(extraNestedKeyBody));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "INVALID_REQUEST" });
    });

    it("validates expirationTime semantics directly via parseSubscribeBody parser", () => {
      const basePayload = {
        endpoint: validBody.endpoint,
        keys: validBody.keys,
      };

      // Valid null, omitted, 0
      expect(parseSubscribeBody({ ...basePayload, expirationTime: null })).not.toBeNull();
      expect(parseSubscribeBody({ ...basePayload })).not.toBeNull();
      expect(parseSubscribeBody({ ...basePayload, expirationTime: 0 })).not.toBeNull();

      // Invalid NaN, Infinity, negative, overflow string
      expect(parseSubscribeBody({ ...basePayload, expirationTime: NaN })).toBeNull();
      expect(parseSubscribeBody({ ...basePayload, expirationTime: Infinity })).toBeNull();
      expect(parseSubscribeBody({ ...basePayload, expirationTime: -100 })).toBeNull();
      expect(parseSubscribeBody({ ...basePayload, expirationTime: "invalid-date-string" })).toBeNull();
    });

    it("executes atomic SAME-USER conditional updateMany when endpoint exists for user", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-100",
        endpoint: validBody.endpoint,
        userId: "admin-1",
        deviceId: null,
        p256dh: "oldP256dh",
        auth: "oldAuth",
        expirationTime: null,
        failureCount: 2,
        lastFailureAt: new Date(),
        lastSuccessfulAt: new Date(10000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, deviceLinked: false });

      expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: "sub-100",
          endpoint: validBody.endpoint,
          userId: "admin-1",
          p256dh: "oldP256dh",
          auth: "oldAuth",
        },
        data: expect.objectContaining({
          p256dh: validBody.keys.p256dh,
          auth: validBody.keys.auth,
          failureCount: 0,
          lastFailureAt: null,
        }),
      });

      // Verify lastSuccessfulAt is NOT mutated
      const updateData = vi.mocked(prisma.webPushSubscription.updateMany).mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty("lastSuccessfulAt");
    });

    it("executes atomic CROSS-USER rebind when exact capability keys match", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "user-b", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-200",
        endpoint: validBody.endpoint,
        userId: "user-a",
        deviceId: null,
        p256dh: validBody.keys.p256dh,
        auth: validBody.keys.auth,
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(200);

      expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: "sub-200",
          endpoint: validBody.endpoint,
          userId: "user-a",
          p256dh: validBody.keys.p256dh,
          auth: validBody.keys.auth,
        },
        data: expect.objectContaining({
          userId: "user-b",
          deviceId: null,
          failureCount: 0,
        }),
      });
    });

    it("accepts D2 subscribe payload with valid deviceInstanceId and links device", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-100",
        endpoint: validBody.endpoint,
        userId: "admin-1",
        deviceId: null,
        p256dh: "oldP256dh",
        auth: "oldAuth",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.pushDevice.findUnique).mockResolvedValue({
        id: "dev-100",
        userId: "admin-1",
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
      });
      vi.mocked(prisma.pushDevice.update).mockResolvedValue({
        id: "dev-100",
        userId: "admin-1",
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
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        const tx = {
          webPushSubscription: {
            findFirst: vi.fn().mockResolvedValue(null),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          pushDevice: {
            update: vi.fn().mockResolvedValue({ id: "dev-100" }),
          },
        };
        const callback = cb as unknown as (txClient: typeof tx) => Promise<unknown>;
        return callback(tx);
      });

      const res = await subscribe(
        makeRequest({
          ...validBody,
          deviceInstanceId: "e3f94c08-724a-4a6c-9c02-e25f82470a29",
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, deviceLinked: true });
    });

    it("rejects subscribe payload with invalid deviceInstanceId (non-UUID)", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      const res = await subscribe(
        makeRequest({
          ...validBody,
          deviceInstanceId: "invalid-device-id",
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "INVALID_REQUEST" });
    });

    it("performs single race re-read if conditional updateMany count === 0", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      // Initial read
      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-1",
        endpoint: validBody.endpoint,
        userId: "admin-1",
        deviceId: null,
        p256dh: "p256dh-snapshot-1",
        auth: "auth-snapshot-1",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // First updateMany lost race (count 0)
      vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValueOnce({ count: 0 });

      // Re-read found updated state by another request
      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-1",
        endpoint: validBody.endpoint,
        userId: "admin-1",
        deviceId: null,
        p256dh: "p256dh-snapshot-2",
        auth: "auth-snapshot-2",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Second updateMany succeeded (count 1)
      vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(200);
      expect(prisma.webPushSubscription.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(2);
    });

    it("returns 409 conflict if re-read reveals cross-user capability key mismatch", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "user-b", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValueOnce({
        id: "sub-1",
        endpoint: validBody.endpoint,
        userId: "user-a",
        deviceId: null,
        p256dh: "differentP256dh",
        auth: "differentAuth",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data).toEqual({ error: "SUBSCRIPTION_ENDPOINT_CONFLICT" });
    });

    it("wraps unexpected server/database errors and returns 500 INTERNAL_ERROR without leaking details", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.findUnique).mockRejectedValueOnce(
        new Error("Database connection pool exhausted")
      );

      const res = await subscribe(makeRequest(validBody));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: "INTERNAL_ERROR" });
      expect(data).not.toHaveProperty("stack");
      expect(data).not.toHaveProperty("message");
    });
  });

  describe("DELETE /api/push/unsubscribe", () => {
    const validUnsubBody = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
      keys: {
        p256dh: "BEl62iUYgUivxIkv69yViEuiBIa_validBase64Url",
        auth: "5r541t_authKeyBase64Url",
      },
    };

    const makeDeleteRequest = (body: unknown, headers: Record<string, string> = {}) => {
      return new Request("https://app.tembarber.com.br/api/push/unsubscribe", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://app.tembarber.com.br",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    };

    it("wraps unexpected database deletion errors with 500 INTERNAL_ERROR", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce({
        user: { id: "admin-1", authLevel: "admin" },
      });

      vi.mocked(prisma.webPushSubscription.deleteMany).mockRejectedValueOnce(
        new Error("Fatal DB Error")
      );

      const res = await unsubscribe(makeDeleteRequest(validUnsubBody));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: "INTERNAL_ERROR" });
    });
  });
});
