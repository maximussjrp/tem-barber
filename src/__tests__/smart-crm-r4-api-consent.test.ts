import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { MarketingConsentStatus, MarketingConsentSource } from "@prisma/client";

const {
  getAdminSessionMock,
  recordMarketingConsentMock,
  getMarketingConsentStatusMock,
  getCustomerConsentHistoryMock,
  prismaMock,
} = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock = {
    user: {
      findUnique: vi.fn(),
    },
    customerBarbershopLink: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
    comanda: {
      findFirst: vi.fn(),
    },
    customerMarketingConsentEvent: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    getAdminSessionMock: vi.fn(),
    recordMarketingConsentMock: vi.fn(),
    getMarketingConsentStatusMock: vi.fn(),
    getCustomerConsentHistoryMock: vi.fn(),
    prismaMock: pMock,
  };
});

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

vi.mock("@/lib/clients/reactivation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/reactivation")>();
  return {
    ...actual,
    recordMarketingConsent: recordMarketingConsentMock,
    getMarketingConsentStatus: getMarketingConsentStatusMock,
    getCustomerConsentHistory: getCustomerConsentHistoryMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { GET, POST } from "@/app/api/admin/clients/[id]/marketing-consent/route";

describe("Smart CRM R4 — Marketing Consent API Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & RBAC", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "OPTED_IN", eventKey: "evt-1" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(401);
    });

    it("returns 403 when user is BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "OPTED_IN", eventKey: "evt-1" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(403);
    });
  });

  describe("Validation & Idempotency", () => {
    it("returns 400 when eventKey is missing", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "OPTED_IN" }), // missing eventKey
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("INVALID_EVENT_KEY");
    });

    it("returns 400 when status is invalid", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "INVALID_STATUS", eventKey: "evt-1" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("INVALID_STATUS");
    });

    it("returns 404 when customer does not exist in tenant", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost/api/admin/clients/c-nonexistent/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "OPTED_IN", eventKey: "evt-1" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-nonexistent" }) });
      expect(res.status).toBe(404);
    });

    it("returns 409 when eventKey is reused with conflicting customer or status", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce({
        id: "evt-old",
        customerId: "c-1",
        eventType: MarketingConsentStatus.OPTED_OUT, // conflict with OPTED_IN
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({ status: "OPTED_IN", eventKey: "evt-conflict" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("EVENT_KEY_CONFLICT");
    });

    it("successfully records explicit OPTED_IN consent", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      recordMarketingConsentMock.mockResolvedValueOnce({
        consent: { id: "consent-1", status: MarketingConsentStatus.OPTED_IN },
        event: { id: "event-1", eventType: MarketingConsentStatus.OPTED_IN },
        isDuplicateEvent: false,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({
          status: "OPTED_IN",
          source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
          eventKey: "evt-valid-1",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isDuplicateEvent).toBe(false);
      expect(recordMarketingConsentMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          barbershopId: "shop-1",
          customerId: "c-1",
          status: MarketingConsentStatus.OPTED_IN,
          eventKey: "evt-valid-1",
          actorUserId: "u-1",
        })
      );
    });
  });
});
