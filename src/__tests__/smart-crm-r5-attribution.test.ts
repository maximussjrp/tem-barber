import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { RecipientConversionStatus, RecipientDispatchStatus } from "@prisma/client";
import { calculateAttributionRate } from "@/lib/clients/reactivation/attribution-engine";

const {
  getAdminSessionMock,
  reconcileCampaignAttributionMock,
  getCampaignAttributionSummaryMock,
  getRecipientAttributionDetailMock,
  getCustomerAttributionHistoryMock,
  prismaMock,
} = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock = {
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    getAdminSessionMock: vi.fn(),
    reconcileCampaignAttributionMock: vi.fn(),
    getCampaignAttributionSummaryMock: vi.fn(),
    getRecipientAttributionDetailMock: vi.fn(),
    getCustomerAttributionHistoryMock: vi.fn(),
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
    reconcileCampaignAttribution: reconcileCampaignAttributionMock,
    getCampaignAttributionSummary: getCampaignAttributionSummaryMock,
    getRecipientAttributionDetail: getRecipientAttributionDetailMock,
    getCustomerAttributionHistory: getCustomerAttributionHistoryMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { POST as reconcileAttributionPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/reconcile-attribution/route";
import { GET as getAttributionSummaryGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/attribution/route";
import { GET as getRecipientDetailGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/attribution/route";
import { GET as getCustomerHistoryGET } from "@/app/api/admin/clients/[id]/attribution-history/route";

describe("Smart CRM R5.1 — Attribution Core API & Engine Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Reconciliation API POST /api/admin/clients/reactivation/manual-campaigns/[campaignId]/reconcile-attribution", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/reconcile-attribution", {
        method: "POST",
      });

      const res = await reconcileAttributionPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 403 when user is a BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/reconcile-attribution", {
        method: "POST",
      });

      const res = await reconcileAttributionPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(403);
    });

    it("reconciles campaign attribution successfully for OWNER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", barbershopId: "b-1", role: "OWNER" },
      });

      reconcileCampaignAttributionMock.mockResolvedValueOnce({
        campaignId: "camp-1",
        contacts: 10,
        customersWithAttributedBooking: 3,
        reactivatedCustomers: 2,
        recoveredRevenue: 150.0,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/reconcile-attribution", {
        method: "POST",
      });

      const res = await reconcileAttributionPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.summary.recoveredRevenue).toBe(150.0);
    });

    it("reconciles campaign attribution successfully for MANAGER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-2", barbershopId: "b-1", role: "MANAGER" },
      });

      reconcileCampaignAttributionMock.mockResolvedValueOnce({
        campaignId: "camp-1",
        contacts: 8,
        customersWithAttributedBooking: 2,
        reactivatedCustomers: 1,
        recoveredRevenue: 90.0,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/reconcile-attribution", {
        method: "POST",
      });

      const res = await reconcileAttributionPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.summary.recoveredRevenue).toBe(90.0);
    });
  });

  describe("Campaign Summary API GET /api/admin/clients/reactivation/manual-campaigns/[campaignId]/attribution", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/attribution", {
        method: "GET",
      });

      const res = await getAttributionSummaryGET(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 403 when user is a BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/attribution", {
        method: "GET",
      });

      const res = await getAttributionSummaryGET(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(403);
    });

    it("returns campaign attribution summary for MANAGER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", barbershopId: "b-1", role: "MANAGER" },
      });

      getCampaignAttributionSummaryMock.mockResolvedValueOnce({
        campaignId: "camp-1",
        name: "Reativação VIP",
        contacts: 5,
        customersWithAttributedBooking: 2,
        reactivatedCustomers: 2,
        bookingRate: 0.4,
        attendanceRate: 1.0,
        conversionRate: 0.4,
        recoveredRevenue: 120.0,
        recipients: [],
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/attribution", {
        method: "GET",
      });

      const res = await getAttributionSummaryGET(req, {
        params: Promise.resolve({ campaignId: "camp-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.summary.bookingRate).toBe(0.4);
      expect(json.summary.recoveredRevenue).toBe(120.0);
    });
  });

  describe("Recipient Attribution Detail API GET /api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/attribution", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/attribution", {
        method: "GET",
      });

      const res = await getRecipientDetailGET(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 403 when user is a BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/attribution", {
        method: "GET",
      });

      const res = await getRecipientDetailGET(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(403);
    });

    it("returns recipient attribution details with evidence for OWNER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", barbershopId: "b-1", role: "OWNER" },
      });

      getRecipientAttributionDetailMock.mockResolvedValueOnce({
        recipient: {
          id: "rec-1",
          campaignId: "camp-1",
          customerId: "cust-1",
          dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
        },
        attribution: {
          conversionStatus: RecipientConversionStatus.REVENUE_ATTRIBUTED,
          canonicalReturnDate: "2026-09-05",
          revenueAttributed: 75.0,
        },
        evidence: {
          appointment: { id: "appt-1", status: "COMPLETED" },
          comandas: [{ id: "cmd-1", paidTotal: 75.0 }],
          timeline: [],
        },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/attribution", {
        method: "GET",
      });

      const res = await getRecipientDetailGET(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.detail.attribution.revenueAttributed).toBe(75.0);
      expect(json.detail.evidence.appointment.status).toBe("COMPLETED");
    });
  });

  describe("Customer Attribution History API GET /api/admin/clients/[customerId]/attribution-history", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/cust-1/attribution-history", {
        method: "GET",
      });

      const res = await getCustomerHistoryGET(req, {
        params: Promise.resolve({ id: "cust-1" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 403 when user is a BARBER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/cust-1/attribution-history", {
        method: "GET",
      });

      const res = await getCustomerHistoryGET(req, {
        params: Promise.resolve({ id: "cust-1" }),
      });

      expect(res.status).toBe(403);
    });

    it("returns cross-campaign history for customer for MANAGER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", barbershopId: "b-1", role: "MANAGER" },
      });

      getCustomerAttributionHistoryMock.mockResolvedValueOnce({
        customerId: "cust-1",
        barbershopId: "b-1",
        totalTouches: 2,
        totalConversions: 1,
        totalRevenueRecovered: 80.0,
        history: [],
      });

      const req = new NextRequest("http://localhost/api/admin/clients/cust-1/attribution-history", {
        method: "GET",
      });

      const res = await getCustomerHistoryGET(req, {
        params: Promise.resolve({ id: "cust-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.history.totalTouches).toBe(2);
      expect(json.history.totalRevenueRecovered).toBe(80.0);
    });
  });

  describe("Normalized Rate Calculations & Invariant Enforcement", () => {
    it("evaluates 0/0 -> 0", () => {
      expect(calculateAttributionRate(0, 0, "bookingRate")).toBe(0);
      expect(calculateAttributionRate(0, 0, "attendanceRate")).toBe(0);
    });

    it("evaluates 0/4 -> 0", () => {
      expect(calculateAttributionRate(0, 4, "bookingRate")).toBe(0);
      expect(calculateAttributionRate(0, 4, "attendanceRate")).toBe(0);
    });

    it("evaluates 1/4 -> 0.25", () => {
      expect(calculateAttributionRate(1, 4, "bookingRate")).toBe(0.25);
      expect(calculateAttributionRate(1, 4, "attendanceRate")).toBe(0.25);
    });

    it("evaluates 2/4 -> 0.5", () => {
      expect(calculateAttributionRate(2, 4, "bookingRate")).toBe(0.5);
      expect(calculateAttributionRate(2, 4, "attendanceRate")).toBe(0.5);
    });

    it("evaluates 4/4 -> 1", () => {
      expect(calculateAttributionRate(4, 4, "bookingRate")).toBe(1);
      expect(calculateAttributionRate(4, 4, "attendanceRate")).toBe(1);
    });

    it("rejects impossible fixture where contacts=4 and reactivated=5 without silent clamping to 1", () => {
      expect(() => calculateAttributionRate(5, 4, "attendanceRate")).toThrowError(
        "INVALID_ATTRIBUTION_RATE: impossible state where attendanceRate numerator (5) is outside [0, 4]."
      );
    });

    it("rejects impossible negative numerators", () => {
      expect(() => calculateAttributionRate(-1, 4, "bookingRate")).toThrowError(
        "INVALID_ATTRIBUTION_RATE: impossible state where bookingRate numerator (-1) is outside [0, 4]."
      );
    });
  });
});