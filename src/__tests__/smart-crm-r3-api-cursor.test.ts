import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { decodeCursor, encodeCursor } from "@/lib/clients/reactivation";

const { getAdminSessionMock, getReactivationCandidatesMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  getReactivationCandidatesMock: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

vi.mock("@/lib/clients/reactivation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/reactivation")>();
  return {
    ...actual,
    getReactivationCandidates: getReactivationCandidatesMock,
  };
});

import { GET } from "@/app/api/admin/clients/reactivation/route";

describe("Smart CRM R3 — Keyset Cursor & API Contract Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encodes and decodes cursor payload safely with base64url", () => {
    const payload = {
      v: 1,
      score: 85,
      daysOverdue: 14,
      customerId: "cust-123-abc",
    };

    const encoded = encodeCursor(payload);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(10);

    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it("throws INVALID_CURSOR on malformed base64 or invalid JSON structure", () => {
    expect(() => decodeCursor("invalid-base64!!!")).toThrow("INVALID_CURSOR");

    const malformedJsonStr = Buffer.from(JSON.stringify({ bad: "data" }), "utf8").toString("base64url");
    expect(() => decodeCursor(malformedJsonStr)).toThrow("INVALID_CURSOR");
  });

  it("stable tie-breaking order: score DESC, daysOverdue DESC, customerId ASC", () => {
    const items = [
      { score: 80, daysOverdue: 10, customerId: "c-3" },
      { score: 80, daysOverdue: 10, customerId: "c-1" },
      { score: 80, daysOverdue: 15, customerId: "c-2" },
      { score: 90, daysOverdue: 5, customerId: "c-4" },
    ];

    items.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
      return a.customerId.localeCompare(b.customerId);
    });

    expect(items.map((i) => i.customerId)).toEqual(["c-4", "c-2", "c-1", "c-3"]);
  });

  describe("Canonical API Route GET /api/admin/clients/reactivation", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation");
      const res = await GET(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Não autenticado.");
    });

    it("returns 403 when user is BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation");
      const res = await GET(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Acesso negado.");
    });

    it("returns 200 for OWNER with tenant candidates", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          user: { id: "u-owner", role: "OWNER" },
          barbershopId: "shop-tenant-1",
        },
      });

      getReactivationCandidatesMock.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalEligible: 0,
        summary: { totalAudited: 0, eligibleCount: 0, suppressedCount: 0 },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation?limit=25");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(getReactivationCandidatesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          barbershopId: "shop-tenant-1",
          limit: 25,
        })
      );
    });

    it("returns 200 for MANAGER with tenant candidates", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          user: { id: "u-manager", role: "MANAGER" },
          barbershopId: "shop-tenant-2",
        },
      });

      getReactivationCandidatesMock.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalEligible: 0,
        summary: { totalAudited: 0, eligibleCount: 0, suppressedCount: 0 },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(getReactivationCandidatesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          barbershopId: "shop-tenant-2",
          limit: 50,
        })
      );
    });

    it("returns 400 on invalid limit param", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          user: { id: "u-owner", role: "OWNER" },
          barbershopId: "shop-tenant-1",
        },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation?limit=invalid");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Parâmetro limit inválido.");
    });

    it("returns 400 on invalid timingState param", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          user: { id: "u-owner", role: "OWNER" },
          barbershopId: "shop-tenant-1",
        },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation?timingState=INVALID_STATE");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Parâmetro timingState inválido.");
    });

    it("returns 400 on invalid pagination cursor", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          user: { id: "u-owner", role: "OWNER" },
          barbershopId: "shop-tenant-1",
        },
      });

      getReactivationCandidatesMock.mockRejectedValueOnce(new Error("INVALID_CURSOR"));

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation?cursor=corrupt_cursor");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid pagination cursor");
    });
  });
});

