import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import crypto from "crypto";

const { requireOperationalSessionMock, prismaMock } = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock = {
    metaOnboardingSession: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    metaConnectionEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    requireOperationalSessionMock: vi.fn(),
    prismaMock: pMock,
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: requireOperationalSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { POST } from "@/app/api/admin/integrations/meta/whatsapp/onboarding/session/route";
import { getMetaReadiness } from "@/lib/meta/config";

describe("POST /api/admin/integrations/meta/whatsapp/onboarding/session", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      META_APP_ID: "meta_app_123",
      META_EMBEDDED_SIGNUP_CONFIG_ID: "config_signup_456",
    };
  });

  describe("RBAC Matrix", () => {
    it("returns error response if unauthenticated", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const res = await POST();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Não autenticado.");
    });

    it("allows OWNER role with HTTP 200", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_owner",
          role: "OWNER",
          memberId: "mem_1",
          barbershopId: "shop_123",
        },
      });

      prismaMock.metaOnboardingSession.updateMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.metaOnboardingSession.create.mockImplementationOnce(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: "session_owner_1",
          ...data,
        })
      );
      prismaMock.metaConnectionEvent.create.mockResolvedValueOnce({ id: "evt_1" });

      const res = await POST();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sessionId).toBe("session_owner_1");
    });

    it("rejects MANAGER role with HTTP 403 (OWNER ONLY)", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_manager",
          role: "MANAGER",
          memberId: "mem_2",
          barbershopId: "shop_123",
        },
      });

      const res = await POST();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Apenas proprietários podem iniciar a conexão com o WhatsApp.");
    });

    it("rejects BARBER role with HTTP 403 (OWNER ONLY)", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_barber",
          role: "BARBER",
          memberId: "mem_3",
          barbershopId: "shop_123",
        },
      });

      const res = await POST();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Apenas proprietários podem iniciar a conexão com o WhatsApp.");
    });

    it("rejects SUPER_ADMIN role with HTTP 403 (OWNER ONLY)", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_super_admin",
          role: "SUPER_ADMIN",
          memberId: "mem_4",
          barbershopId: "shop_123",
        },
      });

      const res = await POST();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Apenas proprietários podem iniciar a conexão com o WhatsApp.");
    });
  });

  describe("Session Lifecycle & Nonce Security", () => {
    it("returns 503 if Meta config is missing on server", async () => {
      process.env.META_APP_ID = "";

      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_owner",
          role: "OWNER",
          memberId: "mem_1",
          barbershopId: "shop_123",
        },
      });

      const res = await POST();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain("incompleta no servidor");
    });

    it("successfully creates onboarding session for OWNER, invalidates old sessions, and logs event", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_owner",
          role: "OWNER",
          memberId: "mem_1",
          barbershopId: "shop_123",
        },
      });

      prismaMock.metaOnboardingSession.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.metaOnboardingSession.create.mockImplementationOnce(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: "session_created_123",
          ...data,
        })
      );
      prismaMock.metaConnectionEvent.create.mockResolvedValueOnce({ id: "evt_123" });

      const res = await POST();
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.sessionId).toBe("session_created_123");
      expect(json.nonce).toHaveLength(64);
      expect(json.appId).toBe("meta_app_123");
      expect(json.configId).toBe("config_signup_456");
      expect(json.expiresAt).toBeDefined();

      // Verify updateMany was called to cancel previous INITIATED sessions
      expect(prismaMock.metaOnboardingSession.updateMany).toHaveBeenCalledWith({
        where: {
          barbershopId: "shop_123",
          status: "INITIATED",
        },
        data: {
          status: "CANCELLED",
        },
      });

      // Verify database stored nonce_hash and NOT raw nonce
      const createCallArgs = prismaMock.metaOnboardingSession.create.mock.calls[0][0];
      expect(createCallArgs.data.nonceHash).toBeDefined();
      expect(createCallArgs.data.nonceHash).not.toBe(json.nonce);
      const expectedHash = crypto.createHash("sha256").update(json.nonce).digest("hex");
      expect(createCallArgs.data.nonceHash).toBe(expectedHash);

      // Verify audit event creation
      expect(prismaMock.metaConnectionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            barbershopId: "shop_123",
            type: "ONBOARDING_STARTED",
            actorUserId: "user_owner",
          }),
        })
      );
    });
  });

  describe("Meta Config & Readiness Pre-Live Hardening", () => {
    it("requires META_GRAPH_API_VERSION without implicit fallback", () => {
      process.env = {
        NODE_ENV: "test",
        META_APP_ID: "app_1",
        META_APP_SECRET: "sec_1",
        META_BUSINESS_ID: "biz_1",
        META_SYSTEM_USER_ID: "sys_1",
        META_SYSTEM_USER_ACCESS_TOKEN: "token_1",
        META_WEBHOOK_VERIFY_TOKEN: "verify_1",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "cfg_1",
        META_WABA_SYSTEM_USER_TASK: "MANAGE",
        META_CREDENTIAL_ENCRYPTION_KEY_V1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      };

      const readiness = getMetaReadiness();
      expect(readiness.ready).toBe(false);
      expect(readiness.missing).toContain("META_GRAPH_API_VERSION");
      expect(readiness.graphApiVersion).toBe("");
    });

    it("requires META_WABA_SYSTEM_USER_TASK to be explicitly MANAGE or DEVELOP", () => {
      process.env = {
        NODE_ENV: "test",
        META_APP_ID: "app_1",
        META_APP_SECRET: "sec_1",
        META_BUSINESS_ID: "biz_1",
        META_SYSTEM_USER_ID: "sys_1",
        META_SYSTEM_USER_ACCESS_TOKEN: "token_1",
        META_WEBHOOK_VERIFY_TOKEN: "verify_1",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "cfg_1",
        META_GRAPH_API_VERSION: "v21.0",
        META_WABA_SYSTEM_USER_TASK: "INVALID_TASK",
        META_CREDENTIAL_ENCRYPTION_KEY_V1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      };

      const readiness = getMetaReadiness();
      expect(readiness.ready).toBe(false);
      expect(readiness.missing).toContain("META_WABA_SYSTEM_USER_TASK");
    });

    it("guarantees secrets are absent from readiness output", () => {
      process.env = {
        NODE_ENV: "test",
        META_APP_ID: "app_1",
        META_APP_SECRET: "secret_app_sensitive",
        META_BUSINESS_ID: "biz_1",
        META_SYSTEM_USER_ID: "sys_1",
        META_SYSTEM_USER_ACCESS_TOKEN: "secret_sys_token",
        META_WEBHOOK_VERIFY_TOKEN: "secret_verify_token",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "cfg_1",
        META_GRAPH_API_VERSION: "v21.0",
        META_WABA_SYSTEM_USER_TASK: "MANAGE",
        META_CREDENTIAL_ENCRYPTION_KEY_V1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      };

      const readiness = getMetaReadiness();
      expect(readiness.ready).toBe(true);
      const jsonStr = JSON.stringify(readiness);
      expect(jsonStr).not.toContain("secret_app_sensitive");
      expect(jsonStr).not.toContain("secret_sys_token");
      expect(jsonStr).not.toContain("secret_verify_token");
      expect(jsonStr).not.toContain("0123456789abcdef");
    });
  });
});
