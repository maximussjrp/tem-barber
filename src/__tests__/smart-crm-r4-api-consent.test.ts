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

    it("rejects OPTED_IN with 400 and no DB write when omitting context, declaration and evidence", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({
          status: "OPTED_IN",
          source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
          eventKey: "evt-missing-proof-1",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("PRIOR_AUTHORIZATION_DECLARATION_REQUIRED");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(recordMarketingConsentMock).not.toHaveBeenCalled();
    });

    it("rejects OPTED_IN with 400 when declaration is false or evidence is short / reason-only", async () => {
      const baseSession = {
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      };

      // Declaração false
      getAdminSessionMock.mockResolvedValueOnce(baseSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resFalseDecl = await POST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            declaredPriorAuthorization: false,
            evidence: "Cliente autorizou via WhatsApp em 11/11",
            eventKey: "evt-false-decl",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resFalseDecl.status).toBe(400);
      expect((await resFalseDecl.json()).error).toBe("PRIOR_AUTHORIZATION_DECLARATION_REQUIRED");

      // Evidência < 10 caracteres
      getAdminSessionMock.mockResolvedValueOnce(baseSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resShortEvidence = await POST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
            declaredPriorAuthorization: true,
            evidence: "ok ok",
            eventKey: "evt-short-ev",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resShortEvidence.status).toBe(400);
      expect((await resShortEvidence.json()).error).toBe("CONSENT_EVIDENCE_REQUIRED");

      // Reason genérico sem evidence
      getAdminSessionMock.mockResolvedValueOnce(baseSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resReasonOnly = await POST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            declaredPriorAuthorization: true,
            reason: "Justificativa longa apenas em reason sem evidence",
            eventKey: "evt-reason-only",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resReasonOnly.status).toBe(400);
      expect((await resReasonOnly.json()).error).toBe("CONSENT_EVIDENCE_REQUIRED");
      expect(recordMarketingConsentMock).not.toHaveBeenCalled();
    });

    it("successfully records explicit OPTED_IN consent with declaredPriorAuthorization=true and valid evidence", async () => {
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
          declaredPriorAuthorization: true,
          evidence: "Cliente autorizou pelo WhatsApp oficial em 11/11/2026",
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
          source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
          evidence: "Cliente autorizou pelo WhatsApp oficial em 11/11/2026",
          eventKey: "evt-valid-1",
          actorUserId: "u-1",
        })
      );
    });

    it("keeps OPTED_OUT working without requiring evidence or prior authorization declaration", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      recordMarketingConsentMock.mockResolvedValueOnce({
        consent: { id: "consent-1", status: MarketingConsentStatus.OPTED_OUT },
        event: { id: "event-2", eventType: MarketingConsentStatus.OPTED_OUT },
        isDuplicateEvent: false,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
        method: "POST",
        body: JSON.stringify({
          status: "OPTED_OUT",
          eventKey: "evt-optout-1",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(recordMarketingConsentMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          barbershopId: "shop-1",
          customerId: "c-1",
          status: MarketingConsentStatus.OPTED_OUT,
          evidence: null,
          reason: null,
          eventKey: "evt-optout-1",
        })
      );
    });

    it("returns 404 and denies access when customer belongs to another barbershop", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: "m-1", barbershopId: "shop-1" },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-other-shop", name: "Outro Cliente" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce(null);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.comanda.findFirst.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost/api/admin/clients/c-other-shop/marketing-consent", {
        method: "POST",
        body: JSON.stringify({
          status: "OPTED_IN",
          source: MarketingConsentSource.ADMIN_WITH_PROOF,
          declaredPriorAuthorization: true,
          evidence: "Comprovante válido que não deve gravar cross-tenant",
          eventKey: "evt-cross-tenant",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "c-other-shop" }) });
      expect(res.status).toBe(404);
      expect(recordMarketingConsentMock).not.toHaveBeenCalled();
    });
  });
});
