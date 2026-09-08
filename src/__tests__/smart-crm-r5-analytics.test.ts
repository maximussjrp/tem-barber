/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAdminSession, mockPrisma } = vi.hoisted(() => {
  const mockPrismaObj: any = {
    reactivationCampaign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    reactivationCampaignRecipient: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
    comanda: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(mockPrismaObj)),
  };

  return {
    mockGetAdminSession: vi.fn(),
    mockPrisma: mockPrismaObj,
  };
});

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: () => mockGetAdminSession(),
}));

vi.mock("@/lib/prisma", () => ({
  default: mockPrisma,
}));

import { GET as listCampaignsGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/route";
import { GET as getAttributionSummaryGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/attribution/route";
import { GET as getRecipientAttributionGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/attribution/route";
import { GET as getCustomerAttributionHistoryGET } from "@/app/api/admin/clients/[customerId]/attribution-history/route";

describe("Smart CRM R5.2 Analytics API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/admin/clients/reactivation/manual-campaigns (List Campaigns)", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      });

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns");
      const res = await listCampaignsGET(req);
      expect(res.status).toBe(401);
    });

    it("returns 403 when user role is BARBER", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-barber", role: "BARBER" },
      });

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns");
      const res = await listCampaignsGET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Acesso não autorizado.");
    });

    it("returns paginated campaigns for OWNER / MANAGER", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-owner", role: "OWNER" },
      });

      mockPrisma.reactivationCampaign.findMany.mockResolvedValueOnce([
        {
          id: "camp-1",
          name: "Lote Reativação Setembro",
          channel: "WHATSAPP_MANUAL",
          status: "COMPLETED",
          scoreVersion: "smart-crm-score-v1",
          recurrenceVersion: "smart-crm-recurrence-v1",
          attributionVersion: "smart-crm-attribution-v1",
          bookingAttributionWindowDays: 14,
          directReturnWindowDays: 30,
          cooldownDays: 14,
          totalRecipients: 10,
          createdAt: new Date("2026-09-01T10:00:00Z"),
          completedAt: new Date("2026-09-01T10:30:00Z"),
          recipients: [
            { id: "r-1", dispatchStatus: "SENT_CONFIRMED", conversionStatus: "REVENUE_ATTRIBUTED", revenueAttributed: 80.0 },
            { id: "r-2", dispatchStatus: "SENT_CONFIRMED", conversionStatus: "BOOKED", revenueAttributed: 0 },
            { id: "r-3", dispatchStatus: "READY", conversionStatus: "NONE", revenueAttributed: 0 },
          ],
        },
      ]);

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns?limit=10");
      const res = await listCampaignsGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.items).toHaveLength(1);
      expect(json.items[0]).toMatchObject({
        id: "camp-1",
        name: "Lote Reativação Setembro",
        contacts: 2,
        reactivatedCustomers: 1,
        recoveredRevenue: 80.0,
      });
    });

    it("supports cursor pagination cleanly", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-manager", role: "MANAGER" },
      });

      // Simulating returning limit + 1 items
      mockPrisma.reactivationCampaign.findMany.mockResolvedValueOnce([
        {
          id: "camp-1",
          name: "Lote 1",
          channel: "WHATSAPP_MANUAL",
          status: "COMPLETED",
          createdAt: new Date("2026-09-02T10:00:00Z"),
          recipients: [],
        },
        {
          id: "camp-2",
          name: "Lote 2",
          channel: "WHATSAPP_MANUAL",
          status: "COMPLETED",
          createdAt: new Date("2026-09-01T10:00:00Z"),
          recipients: [],
        },
      ]);

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns?limit=1");
      const res = await listCampaignsGET(req);
      const json = await res.json();

      expect(json.items).toHaveLength(1);
      expect(json.items[0].id).toBe("camp-1");
      expect(json.nextCursor).toBe("camp-2");
    });

    it("returns 400 when cursor is invalid or not found (Prisma P2025)", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-owner", role: "OWNER" },
      });

      const p2025Error: any = new Error("Record to use to connect with not found");
      p2025Error.code = "P2025";
      mockPrisma.reactivationCampaign.findMany.mockRejectedValueOnce(p2025Error);

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns?cursor=invalid-cursor-id");
      const res = await listCampaignsGET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("INVALID_CURSOR");
    });
  });

  describe("GET Campaign Attribution Summary & Recipient Detail (Zero Side-Effects)", () => {
    it("returns 404 if campaign is not found", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-owner", role: "OWNER" },
      });
      mockPrisma.reactivationCampaign.findFirst.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns/camp-999/attribution");
      const res = await getAttributionSummaryGET(req, { params: Promise.resolve({ campaignId: "camp-999" }) });
      expect(res.status).toBe(404);
    });

    it("returns 404 if recipient is not found", async () => {
      mockGetAdminSession.mockResolvedValueOnce({
        data: { barbershopId: "shop-1", userId: "u-owner", role: "OWNER" },
      });
      mockPrisma.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/r-999/attribution");
      const res = await getRecipientAttributionGET(req, {
        params: Promise.resolve({ campaignId: "camp-1", recipientId: "r-999" }),
      });
      expect(res.status).toBe(404);
    });
  });
});
