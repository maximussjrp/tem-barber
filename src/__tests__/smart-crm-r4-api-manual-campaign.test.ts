import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { CampaignStatus, RecipientDispatchStatus } from "@prisma/client";

const {
  getAdminSessionMock,
  prepareManualReactivationCampaignMock,
  revalidateAndOpenManualRecipientMock,
  confirmManualRecipientSendMock,
  prismaMock,
} = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock = {
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    getAdminSessionMock: vi.fn(),
    prepareManualReactivationCampaignMock: vi.fn(),
    revalidateAndOpenManualRecipientMock: vi.fn(),
    confirmManualRecipientSendMock: vi.fn(),
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
    prepareManualReactivationCampaign: prepareManualReactivationCampaignMock,
    revalidateAndOpenManualRecipient: revalidateAndOpenManualRecipientMock,
    confirmManualRecipientSend: confirmManualRecipientSendMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { POST as prepareCampaignPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/route";
import { POST as openRecipientPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/opened/route";
import { POST as confirmRecipientSendPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/sent-confirmed/route";

describe("Smart CRM R4 — Manual Campaign & Recipient Lifecycle API Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Preparation Endpoint POST /api/admin/clients/reactivation/manual-campaigns", () => {
    it("returns 401 when unauthenticated", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        body: JSON.stringify({ requestKey: "req-1", selectedCustomerIds: ["c-1"], templateKey: "RETURN_REMINDER" }),
      });

      const res = await prepareCampaignPOST(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 when requestKey is missing", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        body: JSON.stringify({ selectedCustomerIds: ["c-1"], templateKey: "RETURN_REMINDER" }),
      });

      const res = await prepareCampaignPOST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("INVALID_REQUEST_KEY");
    });

    it("returns 400 when selectedCustomerIds is empty", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        body: JSON.stringify({ requestKey: "req-1", selectedCustomerIds: [], templateKey: "RETURN_REMINDER" }),
      });

      const res = await prepareCampaignPOST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("EMPTY_SELECTION");
    });

    it("returns 400 when selectedCustomerIds exceeds 50", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const over50 = Array.from({ length: 51 }, (_, i) => `c-${i}`);
      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        body: JSON.stringify({ requestKey: "req-1", selectedCustomerIds: over50, templateKey: "RETURN_REMINDER" }),
      });

      const res = await prepareCampaignPOST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("BATCH_LIMIT_EXCEEDED");
    });

    it("creates campaign session with accepted and rejected candidates", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      prepareManualReactivationCampaignMock.mockResolvedValueOnce({
        campaign: { id: "camp-1", status: CampaignStatus.READY, totalRecipients: 1 },
        accepted: [{ recipientId: "rec-1", customerId: "c-1", customerName: "Cliente 1", dispatchStatus: "READY" }],
        rejected: [{ customerId: "c-2", customerName: "Cliente 2", reasonCode: "CONSENT_UNKNOWN" }],
        isExisting: false,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        body: JSON.stringify({
          requestKey: "req-valid-1",
          selectedCustomerIds: ["c-1", "c-2"],
          templateKey: "RETURN_REMINDER",
        }),
      });

      const res = await prepareCampaignPOST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.accepted.length).toBe(1);
      expect(json.rejected.length).toBe(1);
      expect(json.isExisting).toBe(false);
    });
  });

  describe("Opened Endpoint POST /.../recipients/[recipientId]/opened", () => {
    it("handles stale state rejection (STALE_CONSENT, STALE_BLOCKED, etc.)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const staleErr = Object.assign(new Error("STALE_CONSENT: Customer consent is no longer OPTED_IN."), {
        status: 400,
        code: "STALE_CONSENT",
      });
      revalidateAndOpenManualRecipientMock.mockRejectedValueOnce(staleErr);

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/opened", {
        method: "POST",
      });

      const res = await openRecipientPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("STALE_CONSENT");
    });

    it("successfully returns whatsappUrl on valid opened transition", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      revalidateAndOpenManualRecipientMock.mockResolvedValueOnce({
        whatsappUrl: "https://wa.me/5511999998888?text=Oi%20Cliente",
        recipient: { id: "rec-1", dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED },
        isReplay: false,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/opened", {
        method: "POST",
      });

      const res = await openRecipientPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.whatsappUrl).toContain("https://wa.me/5511999998888");
      expect(json.recipient.dispatchStatus).toBe("WHATSAPP_OPENED");
      expect(json.isReplay).toBe(false);
    });
  });

  describe("Sent Confirmed Endpoint POST /.../recipients/[recipientId]/sent-confirmed", () => {
    it("transitions to SENT_CONFIRMED and returns created contactLog", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      confirmManualRecipientSendMock.mockResolvedValueOnce({
        recipient: { id: "rec-1", dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED },
        contactLog: { id: "log-1", channel: "WHATSAPP", reactivationRecipientId: "rec-1" },
        isExisting: false,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/sent-confirmed", {
        method: "POST",
      });

      const res = await confirmRecipientSendPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.recipient.dispatchStatus).toBe("SENT_CONFIRMED");
      expect(json.contactLog.id).toBe("log-1");
      expect(json.isExisting).toBe(false);
    });

    it("idempotent replay returns existing contactLog without error", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-1", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      confirmManualRecipientSendMock.mockResolvedValueOnce({
        recipient: { id: "rec-1", dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED },
        contactLog: { id: "log-1", channel: "WHATSAPP", reactivationRecipientId: "rec-1" },
        isExisting: true,
      });

      const req = new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/sent-confirmed", {
        method: "POST",
      });

      const res = await confirmRecipientSendPOST(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isExisting).toBe(true);
      expect(json.contactLog.id).toBe("log-1");
    });
  });
});
