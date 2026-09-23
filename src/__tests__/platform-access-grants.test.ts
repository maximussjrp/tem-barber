import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getServerSessionMock, createGrantMock, revokeGrantMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  createGrantMock: vi.fn(),
  revokeGrantMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/billing/access-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/access-grants")>();
  return {
    ...actual,
    createTenantAccessGrant: createGrantMock,
    revokeTenantAccessGrant: revokeGrantMock,
  };
});

import { POST as createGrantRoute } from "@/app/api/admin/platform-access-grants/route";
import { POST as revokeGrantRoute } from "@/app/api/admin/platform-access-grants/[id]/revoke/route";
import { AccessGrantError } from "@/lib/billing/access-grants";

function createReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/platform-access-grants", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function revokeReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/platform-access-grants/grant-1/revoke", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({
    user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" },
  });
  createGrantMock.mockResolvedValue({
    grant: { id: "grant-1", daysGranted: 15, reason: "Teste" },
    isReplay: false,
  });
  revokeGrantMock.mockResolvedValue({
    grant: { id: "grant-1", revokedAt: new Date() },
    alreadyRevoked: false,
  });
});

describe("API: /api/admin/platform-access-grants (Create)", () => {
  it("rejects unauthenticated users with 401", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 10, reason: "Teste", idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-platform roles with 403", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "user-1", email: "barber@shop.com", role: "BARBER" },
    });
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 10, reason: "Teste", idempotencyKey: "k1" }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid daysGranted (zero, negative, > 3650, float)", async () => {
    const invalidDays = [0, -5, 3651, 10.5];
    for (const d of invalidDays) {
      const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: d, reason: "Teste", idempotencyKey: "k1" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("ACCESS_GRANT_INVALID_DAYS");
    }
  });

  it("rejects missing or empty reason with 400", async () => {
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 15, reason: "   ", idempotencyKey: "k1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("ACCESS_GRANT_REASON_REQUIRED");
  });

  it("rejects missing idempotencyKey with 400", async () => {
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 15, reason: "Teste", idempotencyKey: "" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("ACCESS_GRANT_IDEMPOTENCY_KEY_REQUIRED");
  });

  it("succeeds with 200 and delegates to createTenantAccessGrant", async () => {
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 15, reason: "Parceria comercial", idempotencyKey: "k-unique" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grant.id).toBe("grant-1");
    expect(createGrantMock).toHaveBeenCalledWith(expect.objectContaining({
      barbershopId: "shop-1",
      daysGranted: 15,
      reason: "Parceria comercial",
      idempotencyKey: "k-unique",
      actorUserId: "super-id",
    }));
  });

  it("handles AccessGrantError with corresponding status code (e.g. 409 conflict)", async () => {
    createGrantMock.mockRejectedValue(new AccessGrantError("IDEMPOTENCY_CONFLICT", "Replay com parâmetros divergentes", 409));
    const res = await createGrantRoute(createReq({ barbershopId: "shop-1", daysGranted: 15, reason: "Teste", idempotencyKey: "k1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("API: /api/admin/platform-access-grants/[id]/revoke (Revoke)", () => {
  it("rejects unauthenticated users with 401", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await revokeGrantRoute(revokeReq({ reason: "Motivo cancelamento" }), { params: Promise.resolve({ id: "grant-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects non-platform roles with 403", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "user-2", email: "owner@shop.com", role: "OWNER" },
    });
    const res = await revokeGrantRoute(revokeReq({ reason: "Motivo cancelamento" }), { params: Promise.resolve({ id: "grant-1" }) });
    expect(res.status).toBe(403);
  });

  it("rejects empty reason with 400", async () => {
    const res = await revokeGrantRoute(revokeReq({ reason: "   " }), { params: Promise.resolve({ id: "grant-1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("ACCESS_GRANT_REASON_REQUIRED");
  });

  it("successfully revokes grant with 200", async () => {
    const res = await revokeGrantRoute(revokeReq({ reason: "Encerramento de parceria" }), { params: Promise.resolve({ id: "grant-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grant.id).toBe("grant-1");
    expect(json.alreadyRevoked).toBe(false);
    expect(revokeGrantMock).toHaveBeenCalledWith(expect.objectContaining({
      grantId: "grant-1",
      reason: "Encerramento de parceria",
      actorUserId: "super-id",
    }));
  });

  it("handles AccessGrantError from domain (e.g. 409 expired)", async () => {
    revokeGrantMock.mockRejectedValue(new AccessGrantError("ACCESS_GRANT_ALREADY_EXPIRED", "Cortesia já expirou", 409));
    const res = await revokeGrantRoute(revokeReq({ reason: "Motivo cancelamento" }), { params: Promise.resolve({ id: "grant-1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("ACCESS_GRANT_ALREADY_EXPIRED");
  });
});
