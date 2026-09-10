import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireOperationalSessionMock, prismaMock } = vi.hoisted(() => {
  const pMock = {
    metaConnection: {
      findUnique: vi.fn(),
    },
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

import { GET } from "@/app/api/admin/integrations/meta/whatsapp/status/route";

describe("GET /api/admin/integrations/meta/whatsapp/status", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      META_ADMIN_SYSTEM_USER_ACCESS_TOKEN:
        "admin_system_user_token_must_never_be_exposed",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("RBAC Enforcement", () => {
    it("returns 401 if unauthenticated", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const res = await GET();
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
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.configured).toBe(false);
    });

    it("allows MANAGER role with HTTP 200", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_manager",
          role: "MANAGER",
          memberId: "mem_2",
          barbershopId: "shop_123",
        },
      });
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.configured).toBe(false);
    });

    it("rejects BARBER role with HTTP 403", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_barber",
          role: "BARBER",
          memberId: "mem_3",
          barbershopId: "shop_123",
        },
      });

      const res = await GET();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Acesso negado.");
    });

    it("rejects SUPER_ADMIN without specific tenant context with HTTP 403", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_super_admin",
          role: "SUPER_ADMIN",
          memberId: "mem_4",
          barbershopId: "shop_123",
        },
      });

      const res = await GET();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Acesso negado.");
    });
  });

  describe("Status Reporting", () => {
    it("returns configured: false when no MetaConnection exists for tenant", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_owner",
          role: "OWNER",
          memberId: "mem_1",
          barbershopId: "shop_123",
        },
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.configured).toBe(false);
      expect(json.status).toBe("NOT_CONFIGURED");
      expect(json.connection).toBeNull();
      expect(json.systemReadiness).toBeDefined();
    });

    it("returns configured: true and connection metadata (without secrets) when connection exists", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user_owner",
          role: "OWNER",
          memberId: "mem_1",
          barbershopId: "shop_123",
        },
      });

      const now = new Date();
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
        id: "conn_abc",
        barbershopId: "shop_123",
        businessId: "biz_999",
        wabaId: "waba_888",
        phoneNumberId: "phone_777",
        displayPhoneNumber: "+55 17 99999-9999",
        verifiedName: "Barbearia Teste",
        qualityRating: "GREEN",
        wabaReviewStatus: "APPROVED",
        status: "CONNECTED",
        connectedAt: now,
        systemUserAssignedAt: now,
        webhookSubscribedAt: now,
        phoneRegisteredAt: now,
        lastHealthCheckAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      });

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.configured).toBe(true);
      expect(json.status).toBe("CONNECTED");
      expect(json.connection).toBeDefined();
      expect(json.connection.id).toBe("conn_abc");
      expect(json.connection.wabaId).toBe("waba_888");
      expect(json.connection.phoneNumberId).toBe("phone_777");
      expect(json.connection.displayPhoneNumber).toBe("+55 17 99999-9999");
      // Assert no secret fields are present
      expect(json.connection.accessToken).toBeUndefined();
      expect(json.connection.secret).toBeUndefined();
      expect(json.connection.pin).toBeUndefined();
      expect(JSON.stringify(json)).not.toContain(
        "admin_system_user_token_must_never_be_exposed"
      );
    });
  });
});
