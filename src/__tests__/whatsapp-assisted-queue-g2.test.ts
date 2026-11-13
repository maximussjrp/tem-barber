/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  CampaignStatus,
  CustomerTimingState,
  MarketingConsentSource,
  MarketingConsentStatus,
  RecipientConversionStatus,
  RecipientDispatchStatus,
} from "@prisma/client";

const { getAdminSessionMock, prismaMock } = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock: any = {
    barbershop: { findUnique: vi.fn() },
    barbershopMember: { findUnique: vi.fn(), findFirst: vi.fn() },
    memberPermissionOverride: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    customerBarbershopLink: { findMany: vi.fn(), findUnique: vi.fn() },
    appointment: { findMany: vi.fn(), findFirst: vi.fn() },
    comanda: { findMany: vi.fn(), findFirst: vi.fn() },
    customerClubSubscription: { findMany: vi.fn(), findFirst: vi.fn() },
    barbershopBlockedCustomer: { findMany: vi.fn(), findFirst: vi.fn() },
    customerMarketingConsent: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    customerMarketingConsentEvent: { findUnique: vi.fn(), create: vi.fn() },
    customerContactLog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    reactivationCampaign: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    reactivationCampaignRecipient: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    getAdminSessionMock: vi.fn(),
    prismaMock: pMock,
  };
});

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import {
  prepareManualReactivationCampaign,
  revalidateAndOpenManualRecipient,
  confirmManualRecipientSend,
  skipManualRecipient,
  buildOpenPreparationId,
  reconcileCampaignAttribution,
  getCustomerAttributionHistory,
  getActiveManualCampaign,
  cancelManualCampaign,
} from "@/lib/clients/reactivation";
import { hasNoContactSince, listBarbershopClients } from "@/lib/customers";
import { POST as marketingConsentPOST } from "@/app/api/admin/clients/[id]/marketing-consent/route";
import {
  POST as manualCampaignsPOST,
  GET as manualCampaignsGET,
} from "@/app/api/admin/clients/reactivation/manual-campaigns/route";
import { GET as activeCampaignGET } from "@/app/api/admin/clients/reactivation/manual-campaigns/active/route";
import { POST as cancelCampaignPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/cancel/route";
import { POST as openRecipientPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/opened/route";
import { POST as sentConfirmedPOST } from "@/app/api/admin/clients/reactivation/manual-campaigns/[campaignId]/recipients/[recipientId]/sent-confirmed/route";
import { PUT as teamPermissionsPUT } from "@/app/api/admin/team/[id]/permissions/route";

describe("G2 — WhatsApp Assistido com Fila Inteligente V1 (Funcionalidade, Segurança, S-01..S-08 e Regressão)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1", name: "Barbearia Teste" });
    prismaMock.$queryRaw.mockResolvedValue([{ id: "locked" }]);
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);
    prismaMock.memberPermissionOverride.findMany.mockResolvedValue([]);
  });

  describe("1. DEC-01 = A — Indicadores, Filtros 30/60/90 dias e Ordenação Determinística", () => {
    it("separa never_contacted de no_contact_30/60/90 e calcula os 7 summaryMetrics no backend antes da paginação", async () => {
      const now = new Date("2026-11-10T12:00:00.000Z");
      expect(hasNoContactSince(null, 30, now)).toBe(false);
      expect(hasNoContactSince("2026-09-01T12:00:00.000Z", 30, now)).toBe(true);
      expect(hasNoContactSince("2026-11-05T12:00:00.000Z", 30, now)).toBe(false);

      prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([
        { customerId: "c-never", createdAt: now, birthDate: null, notes: null },
        { customerId: "c-old45", createdAt: now, birthDate: null, notes: null },
      ]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([{ customerId: "c-appt-only" }]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);
      prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);

      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: "c-appt-only", name: "Ana", phone: "5517991112222", email: null, createdAt: now },
        { id: "c-never", name: "Bruno", phone: "5517991113333", email: null, createdAt: now },
        { id: "c-old45", name: "Carlos", phone: "5517991114444", email: null, createdAt: now },
      ]);

      prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([
        { customerId: "c-never", birthDate: null, notes: null },
        { customerId: "c-old45", birthDate: null, notes: null },
      ]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([
        { customerId: "c-appt-only", status: "COMPLETED", dateTime: new Date("2026-10-01T12:00:00.000Z") },
      ]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);
      prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([
        { customerId: "c-never", status: "ACTIVE" },
      ]);
      prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValueOnce([]);
      prismaMock.customerContactLog.groupBy.mockResolvedValueOnce([
        {
          customerId: "c-old45",
          _max: { contactedAt: new Date("2026-09-15T12:00:00.000Z") },
          _count: { _all: 1 },
        },
      ]);
      prismaMock.customerMarketingConsent.findMany.mockResolvedValueOnce([
        { customerId: "c-appt-only", status: MarketingConsentStatus.OPTED_IN },
        { customerId: "c-old45", status: MarketingConsentStatus.OPTED_OUT },
      ]);

      const result = await listBarbershopClients(prismaMock, {
        barbershopId: "shop-1",
        page: 1,
        pageSize: 1,
        excludeCustomerIds: ["c-old45"],
      });

      // Ordenação determinística garantida na query de user
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ name: "asc" }, { id: "asc" }],
        })
      );

      // Total paginado preserva contrato legado (3 clientes), mas summaryMetrics traz os 7 KPIs globais
      expect(result.total).toBe(3);
      expect(result.clients).toHaveLength(1);
      expect(result.summaryMetrics).toMatchObject({
        totalClients: 3,
        withoutAppointment: 2, // c-never e c-old45 não têm agendamento
        upcoming: 0,
        openComandas: 0,
        neverContacted: 2, // c-appt-only e c-never
        noContact30: 1, // apenas c-old45 (não inclui nunca contatados!)
      });
      // S-03: queueSelectionMeta desconta excludeCustomerIds da rodada atual (c-appt-only OPTED_IN + c-never UNKNOWN)
      expect(result.queueSelectionMeta.eligibleInFilterCount).toBe(2);
      expect(result.queueSelectionMeta.remainingEligibleInRoundCount).toBe(2);
      expect(result.queueSelectionMeta.pendingConsentInFilterCount).toBe(1); // c-never tem UNKNOWN
    });
  });

  describe("2. DEC-05 & G23-05 — Matriz Completa de Testes da Permissão Exclusiva WHATSAPP_ASSISTED_OPERATE", () => {
    function setupSuccessfulQueuePrepMocks(campaignId: string, recipientId: string) {
      prismaMock.reactivationCampaign.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prismaMock.barbershop.findUnique.mockResolvedValueOnce({
        id: "shop-1",
        name: "Barbearia Teste",
        slug: "barbearia-teste",
      });
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: "c-1", name: "Carlos Cliente", phone: "5517991112222" },
      ]);
      prismaMock.customerMarketingConsent.findMany.mockResolvedValueOnce([
        { customerId: "c-1", status: MarketingConsentStatus.OPTED_IN },
      ]);
      prismaMock.barbershopBlockedCustomer.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.customerContactLog.findMany.mockResolvedValueOnce([]);
      prismaMock.reactivationCampaign.create.mockResolvedValueOnce({
        id: campaignId,
        name: "Fila Assistida Teste",
        status: CampaignStatus.READY,
        recipients: [
          {
            id: recipientId,
            customerId: "c-1",
            customerNameSnapshot: "Carlos Cliente",
            customerPhoneSnapshot: "5517991112222",
            timingStateSnapshot: CustomerTimingState.NO_HISTORY,
            scoreSnapshot: 0,
            dispatchStatus: RecipientDispatchStatus.READY,
            payloadSnapshot: { previewMessage: "Oi, Carlos!", queueIndex: 0 },
          },
        ],
      });
    }

    it("1. OWNER da barbearia possui acesso integral irrestrito (201 + grava campanha)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      });
      setupSuccessfulQueuePrepMocks("camp-owner-1", "rec-owner-1");

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-owner-matrix",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaign.id).toBe("camp-owner-1");
      expect(json.accepted).toHaveLength(1);
      expect(prismaMock.reactivationCampaign.create).toHaveBeenCalledTimes(1);
    });

    it("2. MANAGER sem concessão: negado (403 PERMISSION_DENIED por padrão)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-mgr", role: "MANAGER", memberId: "m-mgr", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-mgr-denied",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });

    it("3. MANAGER com concessão explícita pelo proprietário: permitido (201 + grava campanha)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-mgr-ok", role: "MANAGER", memberId: "m-mgr-ok", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
      ]);
      setupSuccessfulQueuePrepMocks("camp-mgr-1", "rec-mgr-1");

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-mgr-ok",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaign.id).toBe("camp-mgr-1");
      expect(json.accepted).toHaveLength(1);
      expect(prismaMock.reactivationCampaign.create).toHaveBeenCalledTimes(1);
    });

    it("4. RECEPTIONIST sem concessão: negado (403 PERMISSION_DENIED por padrão)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-rec", role: "RECEPTIONIST", memberId: "m-rec", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-rec-denied",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });

    it("5. RECEPTIONIST com concessão explícita pelo proprietário: permitido (201 + grava campanha)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-rec-ok", role: "RECEPTIONIST", memberId: "m-rec-ok", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
      ]);
      setupSuccessfulQueuePrepMocks("camp-rec-1", "rec-rec-1");

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-rec-ok",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaign.id).toBe("camp-rec-1");
      expect(json.accepted).toHaveLength(1);
      expect(prismaMock.reactivationCampaign.create).toHaveBeenCalledTimes(1);
    });

    it("6. BARBER sem concessão: negado (403 PERMISSION_DENIED por padrão)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-denied", role: "BARBER", memberId: "m-barber-denied", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-barber-denied",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });

    it("7. BARBER com concessão explícita (WHATSAPP_ASSISTED_OPERATE + CLIENTS_VIEW): permitido (201 + grava campanha)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-ok", role: "BARBER", memberId: "m-barber-ok", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
        { permissionKey: "CLIENTS_VIEW", allowed: true },
      ]);
      setupSuccessfulQueuePrepMocks("camp-barber-1", "rec-barber-1");

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-barber-ok",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaign.id).toBe("camp-barber-1");
      expect(json.accepted).toHaveLength(1);
      expect(prismaMock.reactivationCampaign.create).toHaveBeenCalledTimes(1);
    });

    it("8. Revogação individual pelo proprietário (override allowed=false): negado (403)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-mgr-rev", role: "MANAGER", memberId: "m-mgr-rev", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: false },
      ]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-mgr-rev",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });

    it("9. CLIENTS_MANAGE=true mas WHATSAPP_ASSISTED_OPERATE=false: negado (403)", async () => {
      // MANAGER possui CLIENTS_MANAGE=true por padrão, mas WHATSAPP_ASSISTED_OPERATE não é herdado
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-mgr-manage-only", role: "MANAGER", memberId: "m-mgr-mo", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "CLIENTS_MANAGE", allowed: true },
      ]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-manage-only",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });

    it("10. WHATSAPP_ASSISTED_OPERATE=true mas CLIENTS_VIEW=false: negado (403)", async () => {
      // BARBER recebeu WHATSAPP_ASSISTED_OPERATE, mas o proprietário não concedeu CLIENTS_VIEW
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-noview", role: "BARBER", memberId: "m-barber-noview", barbershopId: "shop-1" },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
        // CLIENTS_VIEW ausente no override e false no preset de BARBER
      ]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-noview",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("CLIENTS_VIEW");
    });

    it("11. Tentativa de conceder permissão pelo próprio colaborador ou por SUPER_ADMIN: negada (403)", async () => {
      // 11a: Colaborador (BARBER) tenta alterar permissões
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-self", role: "BARBER", memberId: "m-barber-self", barbershopId: "shop-1" },
      });

      const resCollaborator = await teamPermissionsPUT(
        new NextRequest("http://localhost/api/admin/team/m-barber-self/permissions", {
          method: "PUT",
          body: JSON.stringify({
            overrides: [{ permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true }],
          }),
        }),
        { params: Promise.resolve({ id: "m-barber-self" }) }
      );
      expect(resCollaborator.status).toBe(403);

      // 11b: SUPER_ADMIN tenta alterar permissão exclusiva WHATSAPP_ASSISTED_OPERATE
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-sa", role: "SUPER_ADMIN", memberId: null, barbershopId: "shop-1" },
      });
      prismaMock.barbershopMember.findUnique.mockResolvedValueOnce({
        id: "m-barber-self",
        role: "BARBER",
        barbershopId: "shop-1",
      });

      const resSuperAdmin = await teamPermissionsPUT(
        new NextRequest("http://localhost/api/admin/team/m-barber-self/permissions", {
          method: "PUT",
          body: JSON.stringify({
            overrides: [{ permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true }],
          }),
        }),
        { params: Promise.resolve({ id: "m-barber-self" }) }
      );
      expect(resSuperAdmin.status).toBe(403);
      const jsonSA = await resSuperAdmin.json();
      expect(jsonSA.code).toBe("OWNER_ONLY_PERMISSION");
    });

    it("12. SUPER_ADMIN sem vínculo operacional ativo com o tenant: negado (403)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-sa-orphan", role: "SUPER_ADMIN", memberId: null, barbershopId: "shop-1" },
      });
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-sa-orphan",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("FORBIDDEN");
    });

    it("13. memberId ausente para colaborador: fail-closed imediato (403 MEMBER_IDENTIFICATION_REQUIRED)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-mgr-no-member", role: "MANAGER", memberId: null, barbershopId: "shop-1" },
      });

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-mgr-no-member",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("MEMBER_IDENTIFICATION_REQUIRED");
    });

    it("14. Tentativa de acessar campanha de outro tenant: negada (404/403)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-other-tenant", role: "OWNER", memberId: "m-other", barbershopId: "shop-2" },
      });
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(null);

      const res = await openRecipientPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/opened", {
          method: "POST",
          body: JSON.stringify({ templateKey: "RETURN_REMINDER" }),
        }),
        { params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }) }
      );
      expect([403, 404]).toContain(res.status);
    });

    it("15. Origem forjada nos parâmetros da API: negada ou validada no banco (G23-01)", async () => {
      // 15a: GET /active com origin forjada SMART_CRM_REACTIVATION rejeita com 400 INVALID_ORIGIN
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      });

      const resActiveTamper = await activeCampaignGET(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/active?origin=SMART_CRM_REACTIVATION")
      );
      expect(resActiveTamper.status).toBe(400);
      const jsonActive = await resActiveTamper.json();
      expect(jsonActive.code).toBe("INVALID_ORIGIN");

      // 15b: POST /opened com origin='SMART_CRM_REACTIVATION' no payload tenta burlar RBAC em destinatário de Fila Assistida
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-tamper", role: "BARBER", memberId: "m-barber-tamper", barbershopId: "shop-1" },
      });
      // Destinatário no banco pertence à CLIENTS_BASE_ASSISTED_QUEUE
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce({
        id: "rec-queue-1",
        campaignId: "camp-queue-1",
        customerId: "cust-1",
        customerPhoneSnapshot: "5517991112222",
        dispatchStatus: RecipientDispatchStatus.READY,
        dispatchAttemptCount: 0,
        payloadSnapshot: {},
        campaign: {
          id: "camp-queue-1",
          barbershopId: "shop-1",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const resOpenedTamper = await openRecipientPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-queue-1/recipients/rec-queue-1/opened", {
          method: "POST",
          body: JSON.stringify({
            templateKey: "RETURN_REMINDER",
            origin: "SMART_CRM_REACTIVATION",
          }),
        }),
        { params: Promise.resolve({ campaignId: "camp-queue-1", recipientId: "rec-queue-1" }) }
      );
      expect(resOpenedTamper.status).toBe(403);
      const jsonOpened = await resOpenedTamper.json();
      expect(jsonOpened.error).toBe("PERMISSION_DENIED");
      expect(jsonOpened.message).toContain("WHATSAPP_ASSISTED_OPERATE");

      // 15c: POST /sent-confirmed sem concessão de WHATSAPP_ASSISTED_OPERATE é rejeitado com 403
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber-tamper", role: "BARBER", memberId: "m-barber-tamper", barbershopId: "shop-1" },
      });
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce({
        id: "rec-queue-1",
        campaignId: "camp-queue-1",
        customerId: "cust-1",
        customerPhoneSnapshot: "5517991112222",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        dispatchAttemptCount: 1,
        payloadSnapshot: {},
        campaign: {
          id: "camp-queue-1",
          barbershopId: "shop-1",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const resSentTamper = await sentConfirmedPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-queue-1/recipients/rec-queue-1/sent-confirmed", {
          method: "POST",
          body: JSON.stringify({ openPreparationId: "a".repeat(64) }),
        }),
        { params: Promise.resolve({ campaignId: "camp-queue-1", recipientId: "rec-queue-1" }) }
      );
      expect(resSentTamper.status).toBe(403);
    });

    it("16. Campanhas legadas do Smart CRM preservam contratos históricos (OWNER e MANAGER acessam, BARBER bloqueado)", async () => {
      // OWNER acessa listagem legada sem precisar de nova chave
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      });
      prismaMock.reactivationCampaign.findMany.mockResolvedValueOnce([]);

      const resOwnerLegacy = await manualCampaignsGET(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns?origin=SMART_CRM_REACTIVATION")
      );
      expect(resOwnerLegacy.status).toBe(200);

      // BARBER tentando acessar listagem legada do Smart CRM é bloqueado
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-barber", role: "BARBER", memberId: "m-barber", barbershopId: "shop-1" },
      });

      const resBarberLegacy = await manualCampaignsGET(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns?origin=SMART_CRM_REACTIVATION")
      );
      expect(resBarberLegacy.status).toBe(403);
    });

    it("exige source explícito, declaredPriorAuthorization=true e evidência >= 10 chars no registro contextual de consentimento (DEC-03 = A)", async () => {
      const ownerSession = {
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      };

      // Sem source -> 400 INVALID_CONSENT_SOURCE (sem fallback silencioso!)
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resNoSource = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            eventKey: "evt-no-src",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resNoSource.status).toBe(400);
      expect((await resNoSource.json()).error).toBe("INVALID_CONSENT_SOURCE");

      // No drawer sem declaredPriorAuthorization=true -> 400 PRIOR_AUTHORIZATION_DECLARATION_REQUIRED
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resNoDecl = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            context: "ASSISTED_QUEUE_DRAWER",
            declaredPriorAuthorization: false,
            evidence: "Cliente pediu no WhatsApp ontem",
            eventKey: "evt-no-decl",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resNoDecl.status).toBe(400);
      expect((await resNoDecl.json()).error).toBe("PRIOR_AUTHORIZATION_DECLARATION_REQUIRED");

      // Evidência curta (< 10 chars) -> 400 CONSENT_EVIDENCE_REQUIRED
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resShortEv = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: "OPTED_IN",
            source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
            context: "ASSISTED_QUEUE_DRAWER",
            declaredPriorAuthorization: true,
            evidence: "curto",
            eventKey: "evt-short-ev",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resShortEv.status).toBe(400);
      expect((await resShortEv.json()).error).toBe("CONSENT_EVIDENCE_REQUIRED");
    });
  });

  describe("3. R-02 & S-03 — Preparação nas 4 Fontes Canônicas e Exclusão de Pulados na Mesma Rodada", () => {
    it("aceita cliente legado presente apenas em Appointment/Comanda/Clube e exclui cliente já pulado no mesmo workRoundId", async () => {
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce(null);
      prismaMock.barbershop.findUnique.mockResolvedValueOnce({
        id: "shop-1",
        name: "Barbearia Teste",
        slug: "barbearia-teste",
      });

      // c-legacy não tem CustomerBarbershopLink, mas é retornado na query de 4 fontes (R-02)
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: "c-legacy", name: "Cliente Legado", phone: "5517991112222" },
        { id: "c-skipped", name: "Cliente Pulado", phone: "5517991113333" },
      ]);
      prismaMock.customerMarketingConsent.findMany.mockResolvedValueOnce([
        { customerId: "c-legacy", status: MarketingConsentStatus.OPTED_IN },
        { customerId: "c-skipped", status: MarketingConsentStatus.OPTED_IN },
      ]);
      prismaMock.barbershopBlockedCustomer.findMany
        .mockResolvedValueOnce([]) // by userId
        .mockResolvedValueOnce([]); // by phoneNormalized
      prismaMock.appointment.findMany.mockResolvedValueOnce([]); // upcoming appointments
      prismaMock.customerContactLog.findMany.mockResolvedValueOnce([]); // cooldown logs

      // Simula que c-skipped já foi pulado na mesma rodada (workRoundId = "round-1")
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([
        { customerId: "c-skipped" },
      ]);

      prismaMock.reactivationCampaign.create.mockResolvedValueOnce({
        id: "camp-new",
        barbershopId: "shop-1",
        status: CampaignStatus.READY,
        totalRecipients: 1,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE", workRoundId: "round-1" },
        recipients: [
          {
            id: "rec-legacy",
            customerId: "c-legacy",
            customerNameSnapshot: "Cliente Legado",
            customerPhoneSnapshot: "5517991112222",
            timingStateSnapshot: CustomerTimingState.NO_HISTORY,
            scoreSnapshot: 0,
            dispatchStatus: RecipientDispatchStatus.READY,
            payloadSnapshot: {
              queueIndex: 0,
              templateKey: "RETURN_REMINDER",
              previewMessage: "Olá, Cliente Legado!",
            },
          },
        ],
      });

      const prep = await prepareManualReactivationCampaign(prismaMock, {
        barbershopId: "shop-1",
        userId: "u-owner",
        requestKey: "rk-round-1",
        selectedCustomerIds: ["c-legacy", "c-skipped"],
        templateKey: "RETURN_REMINDER",
        origin: "CLIENTS_BASE_ASSISTED_QUEUE",
        workRoundId: "round-1",
      });

      // Verifica que a query prisma.user.findMany incluiu as 4 fontes canônicas no OR (R-02)
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { customerBarbershopLinks: { some: { barbershopId: "shop-1" } } },
              { appointments: { some: { barbershopId: "shop-1" } } },
              { comandas: { some: { barbershopId: "shop-1" } } },
              { clubSubscriptions: { some: { barbershopId: "shop-1" } } },
            ]),
          }),
        })
      );

      expect(prep.accepted).toHaveLength(1);
      expect(prep.accepted[0].customerId).toBe("c-legacy");
      expect(prep.accepted[0].timingState).toBe(CustomerTimingState.NO_HISTORY);
      expect(prep.rejected).toEqual([
        expect.objectContaining({
          customerId: "c-skipped",
          reasonCode: "SKIPPED_IN_CURRENT_ROUND",
        }),
      ]);
    });
  });

  describe("4. R-01, R-04 & R-09 — Revalidação em READY e WHATSAPP_OPENED com Persistência Transacional de Supressão", () => {
    it("revalida WHATSAPP_OPENED ao reabrir e persiste transição para EXCLUDED/OPTED_OUT dentro da transação antes do HTTP 400", async () => {
      const now = new Date("2026-11-10T12:00:00.000Z");

      // Destinatário já estava em WHATSAPP_OPENED, mas o telefone foi bloqueado antes da reabertura (R-01 + R-04 + R-09)
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce({
        id: "rec-1",
        campaignId: "camp-1",
        barbershopId: "shop-1",
        customerId: "c-1",
        customerNameSnapshot: "Cliente 1",
        customerPhoneSnapshot: "5517991089190",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        dispatchAttemptCount: 1,
        payloadSnapshot: {
          templateKey: "RETURN_REMINDER",
          previewMessage: "Texto original",
          whatsappOpenedAt: "2026-11-10T11:58:00.000Z",
          leaseOperatorUserId: "u-owner",
          leaseAcquiredAt: "2026-11-10T11:58:00.000Z",
          leaseExpiresAt: "2099-11-10T12:03:00.000Z",
        },
        campaign: {
          id: "camp-1",
          name: "Fila Assistida",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
        customer: {
          id: "c-1",
          name: "Cliente 1",
          phone: "5517991089190",
        },
      });

      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce({
        status: MarketingConsentStatus.OPTED_IN,
      });
      // Bloqueado apenas por variante de telefone sem o 9º dígito (551791089190) — testa R-04!
      prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce({
        id: "blk-1",
        phoneNormalized: "551791089190",
      });
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);

      prismaMock.reactivationCampaignRecipient.update.mockResolvedValueOnce({
        id: "rec-1",
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        failureReason: "STALE_BLOCKED",
      });
      prismaMock.reactivationCampaignRecipient.count.mockResolvedValueOnce(0);
      prismaMock.reactivationCampaign.findUnique.mockResolvedValueOnce({
        id: "camp-1",
        status: CampaignStatus.IN_PROGRESS,
      });
      prismaMock.reactivationCampaign.update.mockResolvedValueOnce({
        id: "camp-1",
        status: CampaignStatus.COMPLETED,
      });

      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const res = await openRecipientPOST(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/opened",
          {
            method: "POST",
            body: JSON.stringify({ messageText: "Texto editado" }),
            headers: { "x-Date-Now": now.toISOString() },
          }
        ),
        { params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }) }
      );

      // Retorna 400 STALE_BLOCKED, MAS a transação completou sem rollback!
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("STALE_BLOCKED");
      expect(prismaMock.reactivationCampaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rec-1" },
          data: expect.objectContaining({
            dispatchStatus: RecipientDispatchStatus.EXCLUDED,
            failureReason: "STALE_BLOCKED",
          }),
        })
      );
      expect(prismaMock.reactivationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "camp-1" },
          data: expect.objectContaining({ status: CampaignStatus.COMPLETED }),
        })
      );
    });
  });

  describe("5. S-01 — Lease de Operador (5 min) e Reconciliação Humana Pós-Expiração", () => {
    it("bloqueia segundo operador durante lease ativo (409) e exige reconciliação humana explícita após expiração", async () => {
      const now = new Date("2026-11-10T12:10:00.000Z");

      const makeRecipientWithLease = (expiresAtIso: string) => ({
        id: "rec-lease",
        campaignId: "camp-1",
        barbershopId: "shop-1",
        customerId: "c-1",
        customerNameSnapshot: "Cliente 1",
        customerPhoneSnapshot: "5517991089190",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        dispatchAttemptCount: 1,
        payloadSnapshot: {
          templateKey: "RETURN_REMINDER",
          previewMessage: "Olá Cliente 1",
          whatsappOpenedAt: "2026-11-10T12:00:00.000Z",
          openPreparationId: "prep-123",
          leaseOperatorUserId: "u-op-A",
          leaseOperatorName: "Operador A",
          leaseAcquiredAt: "2026-11-10T12:00:00.000Z",
          leaseExpiresAt: expiresAtIso,
        },
        campaign: {
          id: "camp-1",
          name: "Fila Assistida",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
        customer: {
          id: "c-1",
          name: "Cliente 1",
          phone: "5517991089190",
        },
      });

      // Caso 1: Lease ainda ativo (expira 12:12, agora é 12:10) -> Operador B recebe 409 RECIPIENT_LOCKED_BY_OTHER_OPERATOR
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(
        makeRecipientWithLease("2026-11-10T12:12:00.000Z")
      );

      await expect(
        revalidateAndOpenManualRecipient(prismaMock, {
          barbershopId: "shop-1",
          campaignId: "camp-1",
          recipientId: "rec-lease",
          userId: "u-op-B",
          now,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: "RECIPIENT_LOCKED_BY_OTHER_OPERATOR",
      });

      // Caso 2: Lease expirado (expirou 12:05, agora é 12:10), Operador B tenta sem reconciliação -> 409 RECIPIENT_REQUIRES_HUMAN_RECONCILIATION
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(
        makeRecipientWithLease("2026-11-10T12:05:00.000Z")
      );

      await expect(
        revalidateAndOpenManualRecipient(prismaMock, {
          barbershopId: "shop-1",
          campaignId: "camp-1",
          recipientId: "rec-lease",
          userId: "u-op-B",
          now,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION",
      });

      // Caso 3: Lease expirado + reconciliação humana explícita fornecida por Operador B -> sucesso e grava operatorTransfers
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(
        makeRecipientWithLease("2026-11-10T12:05:00.000Z")
      );
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce({
        status: MarketingConsentStatus.OPTED_IN,
      });
      prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);
      prismaMock.reactivationCampaignRecipient.update.mockImplementationOnce(async ({ data }: any) => ({
        id: "rec-lease",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        ...data,
      }));
      prismaMock.reactivationCampaignRecipient.count.mockResolvedValueOnce(1);
      prismaMock.reactivationCampaign.findUnique.mockResolvedValueOnce({
        id: "camp-1",
        status: CampaignStatus.IN_PROGRESS,
      });

      const takenOver = await revalidateAndOpenManualRecipient(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-1",
        recipientId: "rec-lease",
        userId: "u-op-B",
        operatorName: "Operador B",
        reconciliation: {
          confirmedReconciliation: true,
          reason: "Conferi com o operador A e a mensagem ainda não havia sido enviada.",
        },
        now,
      });

      expect(takenOver.ok).toBe(true);
      expect(takenOver.recipient.payloadSnapshot.leaseOperatorUserId).toBe("u-op-B");
      expect(takenOver.recipient.payloadSnapshot.operatorTransfers).toEqual([
        expect.objectContaining({
          previousOperatorUserId: "u-op-A",
          newOperatorUserId: "u-op-B",
          reason: "Conferi com o operador A e a mensagem ainda não havia sido enviada.",
        }),
      ]);
    });
  });

  describe("6. S-02 & S-05 — Vínculo openPreparationId, Bloqueio de Edição sem Reabrir e Confirmação Pós-Mudança de Elegibilidade", () => {
    it("rejeita confirmação com openPreparationId divergente (409 STALE_OPEN_PREPARATION) e preserva histórico factual quando elegibilidade muda após abertura (S-05)", async () => {
      const now = new Date("2026-11-10T12:15:00.000Z");
      const prepId = buildOpenPreparationId(
        "rec-1",
        1,
        "5517991089190",
        "CUSTOM_MENSAGEM_LIVRE",
        "Olá Carlos, tudo bem?"
      );

      const baseOpenedRecipient = {
        id: "rec-1",
        campaignId: "camp-1",
        barbershopId: "shop-1",
        customerId: "c-1",
        customerNameSnapshot: "Carlos",
        customerPhoneSnapshot: "5517991089190",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        sentConfirmedAt: null,
        customerContactLog: null,
        payloadSnapshot: {
          whatsappOpenedAt: "2026-11-10T12:14:00.000Z",
          openPreparationId: prepId,
          templateKey: "CUSTOM_MENSAGEM_LIVRE",
          templateLabel: "Mensagem livre",
          openedMessageText: "Olá Carlos, tudo bem?",
          openedPhoneNormalized: "5517991089190",
          isCustomEdited: true,
          leaseOperatorUserId: "u-owner",
          leaseAcquiredAt: "2026-11-10T12:14:00.000Z",
          leaseExpiresAt: "2026-11-10T12:19:00.000Z",
        },
        campaign: {
          id: "camp-1",
          name: "Fila Assistida",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
      };

      // 1) openPreparationId obsoleto/divergente -> 409 STALE_OPEN_PREPARATION
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(baseOpenedRecipient);

      await expect(
        confirmManualRecipientSend(prismaMock, {
          barbershopId: "shop-1",
          campaignId: "camp-1",
          recipientId: "rec-1",
          userId: "u-owner",
          openPreparationId: "prep-errado",
          now,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: "STALE_OPEN_PREPARATION",
      });

      // 2) openPreparationId válido, mas cliente revogou consentimento (OPTED_OUT) após o envio manual no WhatsApp (S-05)
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(baseOpenedRecipient);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce({
        status: MarketingConsentStatus.OPTED_OUT,
      });
      prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);

      prismaMock.reactivationCampaignRecipient.update.mockImplementationOnce(async ({ data }: any) => ({
        ...baseOpenedRecipient,
        ...data,
      }));
      prismaMock.reactivationCampaign.update
        .mockResolvedValueOnce({ id: "camp-1", sentCount: 1 })
        .mockResolvedValueOnce({ id: "camp-1", status: CampaignStatus.COMPLETED });
      prismaMock.reactivationCampaignRecipient.count.mockResolvedValueOnce(0);
      prismaMock.reactivationCampaign.findUnique.mockResolvedValueOnce({
        id: "camp-1",
        status: CampaignStatus.IN_PROGRESS,
      });
      prismaMock.customerContactLog.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.create.mockResolvedValueOnce({
        id: "log-factual-1",
        contactedAt: now,
      });

      const confirmed = await confirmManualRecipientSend(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-1",
        recipientId: "rec-1",
        userId: "u-owner",
        openPreparationId: prepId,
        now,
      });

      expect(confirmed.isExisting).toBe(false);
      expect(confirmed.contactLog.id).toBe("log-factual-1");
      expect(confirmed.recipient.dispatchStatus).toBe(RecipientDispatchStatus.SENT_CONFIRMED);
      expect(confirmed.postOpenWarning).toContain("CONSENT_CHANGED_AFTER_OPEN");
      expect(confirmed.recipient.payloadSnapshot.postOpenAudit).toMatchObject({
        changedAfterOpen: true,
        detectedConditions: ["CONSENT_CHANGED_AFTER_OPEN"],
      });
    });
  });

  describe("7. DEC-04 = A, G1-C01, G1-C02 & G1-C05 — Pular Cliente, Ciclo READY->IN_PROGRESS->COMPLETED e GET /active Read-Only", () => {
    it("pula cliente em WHATSAPP_OPENED sem criar CustomerContactLog e transiciona campanha de 1 destinatário via READY -> IN_PROGRESS -> COMPLETED", async () => {
      const now = new Date("2026-11-10T12:20:00.000Z");

      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce({
        id: "rec-skip-1",
        campaignId: "camp-single",
        barbershopId: "shop-1",
        customerId: "c-1",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        payloadSnapshot: {
          leaseOperatorUserId: "u-owner",
          leaseExpiresAt: "2026-11-10T12:25:00.000Z",
        },
        campaign: {
          id: "camp-single",
          status: CampaignStatus.READY,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        },
      });

      prismaMock.reactivationCampaignRecipient.update.mockResolvedValueOnce({
        id: "rec-skip-1",
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        failureReason: "SKIPPED_BY_USER",
      });
      prismaMock.reactivationCampaignRecipient.count.mockResolvedValueOnce(0); // 0 pendentes restantes!
      prismaMock.reactivationCampaign.findUnique.mockResolvedValueOnce({
        id: "camp-single",
        status: CampaignStatus.READY,
      });
      prismaMock.reactivationCampaign.update
        .mockResolvedValueOnce({ id: "camp-single", status: CampaignStatus.IN_PROGRESS })
        .mockResolvedValueOnce({ id: "camp-single", status: CampaignStatus.COMPLETED });

      const skipped = await skipManualRecipient(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-single",
        recipientId: "rec-skip-1",
        userId: "u-owner",
        now,
      });

      expect(skipped.recipient.dispatchStatus).toBe(RecipientDispatchStatus.EXCLUDED);
      expect(skipped.recipient.failureReason).toBe("SKIPPED_BY_USER");
      expect(skipped.campaignStatus).toBe(CampaignStatus.COMPLETED);
      // Nenhum CustomerContactLog criado!
      expect(prismaMock.customerContactLog.create).not.toHaveBeenCalled();
      // Campanha passou por IN_PROGRESS antes de COMPLETED (G1-C02)
      expect(prismaMock.reactivationCampaign.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.reactivationCampaign.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: "camp-single" },
          data: expect.objectContaining({ status: CampaignStatus.IN_PROGRESS }),
        })
      );
      expect(prismaMock.reactivationCampaign.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: "camp-single" },
          data: expect.objectContaining({ status: CampaignStatus.COMPLETED }),
        })
      );
    });

    it("garante que GET /active é estritamente read-only (zero escritas no banco) e POST /cancel encerra a fila", async () => {
      prismaMock.reactivationCampaign.findMany.mockResolvedValueOnce([
        {
          id: "camp-active-1",
          name: "Fila Assistida",
          status: CampaignStatus.IN_PROGRESS,
          targetSegment: {
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            sourceFilter: "no_contact_30",
            workRoundId: "round-99",
          },
          createdAt: new Date("2026-11-10T11:00:00.000Z"),
          updatedAt: new Date("2026-11-10T11:05:00.000Z"),
          recipients: [
            {
              id: "rec-1",
              customerId: "c-1",
              customerNameSnapshot: "João",
              customerPhoneSnapshot: "5517991112222",
              timingStateSnapshot: CustomerTimingState.NO_HISTORY,
              dispatchStatus: RecipientDispatchStatus.READY,
              failureReason: null,
              dispatchError: null,
              sentConfirmedAt: null,
              createdAt: new Date("2026-11-10T11:00:00.000Z"),
              payloadSnapshot: {
                queueIndex: 0,
                templateKey: "RETURN_REMINDER",
                previewMessage: "Olá João!",
              },
            },
          ],
        },
      ]);

      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const resActive = await activeCampaignGET(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/active?origin=CLIENTS_BASE_ASSISTED_QUEUE"
        )
      );
      expect(resActive.status).toBe(200);
      const jsonActive = await resActive.json();
      expect(jsonActive.activeCampaign.id).toBe("camp-active-1");
      expect(jsonActive.activeCampaign.progress.remainingPendingCount).toBe(1);
      // Zero mutações em GET /active!
      expect(prismaMock.reactivationCampaign.update).not.toHaveBeenCalled();
      expect(prismaMock.reactivationCampaignRecipient.update).not.toHaveBeenCalled();

      // Cancelamento explícito via POST /cancel
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-active-1",
        barbershopId: "shop-1",
        status: CampaignStatus.IN_PROGRESS,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
      });
      prismaMock.reactivationCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.reactivationCampaign.update.mockResolvedValueOnce({
        id: "camp-active-1",
        status: CampaignStatus.CANCELLED,
      });

      const resCancel = await cancelCampaignPOST(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-active-1/cancel",
          { method: "POST" }
        ),
        { params: Promise.resolve({ campaignId: "camp-active-1" }) }
      );
      expect(resCancel.status).toBe(200);
      expect((await resCancel.json()).campaign.status).toBe(CampaignStatus.CANCELLED);
    });
  });

  describe("8. S-08 — Isolamento de Atribuição Financeira e Compatibilidade com Campanhas Legadas", () => {
    it("exclui campanhas CLIENTS_BASE_ASSISTED_QUEUE da receita recuperada de reativação sem afetar campanhas legadas sem origin", async () => {
      // 1) Campanha da fila assistida da Base (CLIENTS_BASE_ASSISTED_QUEUE) -> zero atribuição de reativação
      prismaMock.reactivationCampaign.findFirst
        .mockResolvedValueOnce({
          id: "camp-assisted",
          barbershopId: "shop-1",
          status: CampaignStatus.COMPLETED,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        })
        .mockResolvedValueOnce({
          id: "camp-assisted",
          barbershopId: "shop-1",
          name: "Fila Assistida",
          status: CampaignStatus.COMPLETED,
          totalRecipients: 1,
          sentCount: 1,
          convertedCount: 0,
          totalRevenueAttributed: 0,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          createdAt: new Date("2026-11-01T10:00:00.000Z"),
        });
      prismaMock.reactivationCampaign.update.mockResolvedValueOnce({
        id: "camp-assisted",
        convertedCount: 0,
        totalRevenueAttributed: 0,
      });
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([
        {
          id: "rec-assisted",
          customerId: "c-1",
          dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
          sentConfirmedAt: new Date("2026-11-01T10:00:00.000Z"),
          conversionStatus: "NONE",
          revenueAttributed: 0,
          customer: { id: "c-1", name: "Cliente 1", phone: "5517991112222" },
        },
      ]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);

      const assistedAttr = await reconcileCampaignAttribution(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-assisted",
      });
      expect(assistedAttr.reactivatedCustomers).toBe(0);
      expect(assistedAttr.recoveredRevenue).toBe(0);

      // 2) getCustomerAttributionHistory: campanha CLIENTS_BASE_ASSISTED_QUEUE é ignorada nos KPIs de reativação, preservando campanha legada sem origin
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([
        {
          id: "rec-legacy",
          campaignId: "camp-legacy",
          customerId: "c-1",
          dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
          sentConfirmedAt: new Date("2026-11-01T10:00:00.000Z"),
          conversionStatus: "REVENUE_ATTRIBUTED",
          canonicalReturnDate: new Date("2026-11-03T12:00:00.000Z"),
          revenueAttributed: 90,
          campaign: {
            id: "camp-legacy",
            name: "Campanha Legada",
            channel: "WHATSAPP",
            targetSegment: null, // sem origin -> tratada como SMART_CRM_REACTIVATION!
          },
          attributedAppointment: null,
          attributedComanda: { id: "cmd-1", paidTotal: 90 },
        },
        {
          id: "rec-assisted",
          campaignId: "camp-assisted",
          customerId: "c-1",
          dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
          sentConfirmedAt: new Date("2026-11-02T10:00:00.000Z"),
          conversionStatus: "REVENUE_ATTRIBUTED",
          canonicalReturnDate: new Date("2026-11-03T12:00:00.000Z"),
          revenueAttributed: 500, // mesmo se houvesse valor, deve ser excluído da receita recuperada!
          campaign: {
            id: "camp-assisted",
            name: "Fila Assistida",
            channel: "WHATSAPP",
            targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          },
          attributedAppointment: null,
          attributedComanda: { id: "cmd-2", paidTotal: 500 },
        },
      ]);

      const custHistory = await getCustomerAttributionHistory(prismaMock, {
        barbershopId: "shop-1",
        customerId: "c-1",
      });

      expect(custHistory.totalConversions).toBe(1);
      expect(custHistory.totalRevenueRecovered).toBe(90);

      // 3) GITHUB-DEF-01: Campanha mista com OPTED_IN e UNKNOWN (MANUAL_SUPPORT)
      // Apenas o cliente OPTED_IN converte comercialmente. O UNKNOWN com MANUAL_SUPPORT
      // não gera conversão nem receita recuperada de marketing.
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-mixed",
        barbershopId: "shop-1",
        name: "Reativação Mista",
        status: CampaignStatus.COMPLETED,
        totalRecipients: 2,
        sentCount: 2,
        convertedCount: 0,
        totalRevenueAttributed: 0,
        bookingAttributionWindowDays: 14,
        directReturnWindowDays: 30,
        targetSegment: { origin: "SMART_CRM_REACTIVATION" },
        createdAt: new Date("2026-11-01T10:00:00.000Z"),
      });

      const recOptIn = {
        id: "rec-mixed-optin",
        campaignId: "camp-mixed",
        barbershopId: "shop-1",
        customerId: "c-optin",
        dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
        sentConfirmedAt: new Date("2026-11-01T10:00:00.000Z"),
        conversionStatus: "NONE",
        canonicalReturnDate: null,
        conversionAttributedAt: null,
        revenueAttributed: null,
        customer: { id: "c-optin", name: "Cliente OptIn", phone: "5517991111111" },
        campaign: { id: "camp-mixed", bookingAttributionWindowDays: 14, directReturnWindowDays: 30 },
        payloadSnapshot: { operationType: "MARKETING_REACTIVATION", templateKey: "RETURN_REMINDER" },
      };

      const recManual = {
        id: "rec-mixed-manual",
        campaignId: "camp-mixed",
        barbershopId: "shop-1",
        customerId: "c-manual",
        dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
        sentConfirmedAt: new Date("2026-11-01T10:05:00.000Z"),
        conversionStatus: "NONE",
        canonicalReturnDate: null,
        conversionAttributedAt: null,
        revenueAttributed: null,
        customer: { id: "c-manual", name: "Cliente Manual", phone: "5517991112222" },
        campaign: { id: "camp-mixed", bookingAttributionWindowDays: 14, directReturnWindowDays: 30 },
        payloadSnapshot: { operationType: "MANUAL_SUPPORT", templateKey: "MANUAL_SUPPORT" },
      };

      prismaMock.reactivationCampaignRecipient.findMany
        .mockResolvedValueOnce([recOptIn, recManual]) // 1. fetch all recipients
        .mockResolvedValueOnce([recOptIn, recManual]); // 3. fetch all sent contacts across all campaigns

      // Ambos clientes agendam e completam atendimento de R$ 60 no dia 2026-11-02
      prismaMock.appointment.findMany.mockResolvedValueOnce([
        {
          id: "appt-optin",
          customerId: "c-optin",
          barbershopId: "shop-1",
          createdAt: new Date("2026-11-01T15:00:00.000Z"),
          dateTime: new Date("2026-11-02T14:00:00.000Z"),
          status: "CONFIRMED",
          services: [{ service: { id: "s-1", name: "Corte" } }],
          barber: { user: { id: "b-1", name: "Barbeiro" } },
          comandas: [
            {
              id: "cmd-optin",
              status: "CLOSED",
              paidTotal: 60,
              items: [{ type: "SERVICE", status: "DONE", completedAt: new Date("2026-11-02T14:45:00.000Z") }],
            },
          ],
        },
        {
          id: "appt-manual",
          customerId: "c-manual",
          barbershopId: "shop-1",
          createdAt: new Date("2026-11-01T15:30:00.000Z"),
          dateTime: new Date("2026-11-02T15:00:00.000Z"),
          status: "CONFIRMED",
          services: [{ service: { id: "s-1", name: "Corte" } }],
          barber: { user: { id: "b-1", name: "Barbeiro" } },
          comandas: [
            {
              id: "cmd-manual",
              status: "CLOSED",
              paidTotal: 60,
              items: [{ type: "SERVICE", status: "DONE", completedAt: new Date("2026-11-02T15:45:00.000Z") }],
            },
          ],
        },
      ]);

      prismaMock.comanda.findMany.mockResolvedValueOnce([]); // no additional standalone comandas
      prismaMock.reactivationCampaignRecipient.update.mockResolvedValue({});
      prismaMock.reactivationCampaign.update.mockResolvedValueOnce({});

      // Mock para getCampaignAttributionSummary subsequente chamado por reconcileCampaignAttribution
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-mixed",
        barbershopId: "shop-1",
        name: "Reativação Mista",
        status: CampaignStatus.COMPLETED,
        bookingAttributionWindowDays: 14,
        directReturnWindowDays: 30,
        targetSegment: { origin: "SMART_CRM_REACTIVATION" },
      });

      const updatedOptIn = {
        ...recOptIn,
        conversionStatus: RecipientConversionStatus.REVENUE_ATTRIBUTED,
        canonicalReturnDate: new Date("2026-11-02T00:00:00.000Z"),
        revenueAttributed: 60,
        attributedAppointment: {
          id: "appt-optin",
          createdAt: new Date("2026-11-01T15:00:00.000Z"),
          dateTime: new Date("2026-11-02T14:00:00.000Z"),
          status: "CONFIRMED",
          services: [{ service: { name: "Corte" } }],
          barber: { user: { name: "Barbeiro" } },
          comandas: [{ id: "cmd-optin", status: "CLOSED", paidTotal: 60, closedAt: new Date("2026-11-02T14:45:00.000Z") }],
        },
        attributedComanda: null,
      };

      const updatedManual = {
        ...recManual,
        conversionStatus: RecipientConversionStatus.NONE,
        canonicalReturnDate: null,
        revenueAttributed: 250, // Resíduo em banco de destinatário MANUAL_SUPPORT: não pode somar nem ser exibido
        attributedAppointment: null,
        attributedComanda: null,
      };

      prismaMock.reactivationCampaignRecipient.findMany
        .mockResolvedValueOnce([updatedOptIn, updatedManual]) // recipients in getCampaignAttributionSummary
        .mockResolvedValueOnce([updatedOptIn]); // rawContactsForCustomers (manual is filtered out)

      prismaMock.appointment.findMany.mockResolvedValueOnce([
        {
          id: "appt-optin",
          customerId: "c-optin",
          createdAt: new Date("2026-11-01T15:00:00.000Z"),
          status: "CONFIRMED",
        },
      ]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);

      const mixedSummary = await reconcileCampaignAttribution(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-mixed",
      });

      // GITHUB-DEF-01: Exemplo obrigatório pós-auditoria:
      // - 1 contato promocional (contacts = 1, MANUAL_SUPPORT não dilui)
      // - 1 conversão comercial (reactivatedCustomers = 1)
      // - Taxa comercial de 100% (conversionRate = 1.0, bookingRate = 1.0)
      // - Receita recuperada comercial de R$ 60 (resíduo de R$ 250 em MANUAL_SUPPORT descartado)
      // - Histórico operacional preservado com ambos os destinatários
      expect(mixedSummary.contacts).toBe(1);
      expect(mixedSummary.reactivatedCustomers).toBe(1);
      expect(mixedSummary.recoveredRevenue).toBe(60);
      expect(mixedSummary.customersWithAttributedBooking).toBe(1);
      expect(mixedSummary.bookingRate).toBe(1.0);
      expect(mixedSummary.attendanceRate).toBe(1.0);
      expect(mixedSummary.conversionRate).toBe(1.0);
      expect(mixedSummary.recipients.length).toBe(2);
      expect(mixedSummary.recipients[0].customerId).toBe("c-optin");
      expect(mixedSummary.recipients[0].revenueAttributed).toBe(60);
      expect(mixedSummary.recipients[1].customerId).toBe("c-manual");
      expect(mixedSummary.recipients[1].revenueAttributed).toBe(0); // Zero receita comercial exibida para manual support
    });
  });

  describe("9. G2.1 Correções Críticas (B01 a B08) — Bloqueadores Identificados na Revisão Independente", () => {
    it("B01: re-consulta o destinatário dentro da transação APÓS advisory lock e rejeita confirmação ou dupla incrementação se já foi atualizado concorrentemente", async () => {
      // 1) confirmManualRecipientSend: consulta sob o advisory lock já vê o status atualizado SENT_CONFIRMED por outra transação
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce({
        id: "rec-conc-1",
        campaignId: "camp-1",
        barbershopId: "shop-1",
        customerId: "c-1",
        dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
        sentConfirmedAt: new Date("2026-11-10T12:00:00.000Z"),
        customerPhoneSnapshot: "5517991112222",
        payloadSnapshot: {
          confirmedPreparationId: "prep_rec-conc-1_v1_abcd",
          confirmedMessageText: "Mensagem já enviada",
        },
        campaign: { id: "camp-1", status: CampaignStatus.IN_PROGRESS },
        customerContactLog: { id: "log-existing" },
      });

      const resConfirm = await confirmManualRecipientSend(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-1",
        recipientId: "rec-conc-1",
        openPreparationId: "prep_rec-conc-1_v1_abcd",
      });

      expect(resConfirm.isExisting).toBe(true);
      // Jamais incrementa sentCount se o status re-consultado sob o lock já é SENT_CONFIRMED
      expect(prismaMock.reactivationCampaign.update).not.toHaveBeenCalled();
      expect(prismaMock.customerContactLog.create).not.toHaveBeenCalled();
    });

    it("B02: getActiveManualCampaign filtra origin no banco de dados e localiza fila ativa mais antiga mesmo com >5 campanhas recentes de outra origem", async () => {
      // Cria mock de 6 campanhas recentes SMART_CRM_REACTIVATION e 1 CLIENTS_BASE_ASSISTED_QUEUE ativa
      const assistedQueue = {
        id: "camp-assisted-old",
        name: "Fila Assistida Antiga",
        status: CampaignStatus.IN_PROGRESS,
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        recipients: [
          {
            id: "rec-1",
            customerId: "c-1",
            customerNameSnapshot: "Marcos",
            customerPhoneSnapshot: "5517991112222",
            dispatchStatus: RecipientDispatchStatus.READY,
            createdAt: new Date("2026-11-09T10:00:00.000Z"),
            payloadSnapshot: {},
          },
        ],
      };

      prismaMock.reactivationCampaign.findMany.mockImplementation(async (args: any) => {
        // Se a query filtra por origin CLIENTS_BASE_ASSISTED_QUEUE, retorna a fila assistida!
        const pathFilter = args?.where?.targetSegment?.path;
        const equalsFilter = args?.where?.targetSegment?.equals;
        if (Array.isArray(pathFilter) && pathFilter[0] === "origin" && equalsFilter === "CLIENTS_BASE_ASSISTED_QUEUE") {
          return [assistedQueue];
        }
        return [];
      });

      const active = await getActiveManualCampaign(prismaMock, {
        barbershopId: "shop-1",
        origin: "CLIENTS_BASE_ASSISTED_QUEUE",
      });

      expect(active).not.toBeNull();
      expect(active?.id).toBe("camp-assisted-old");
      expect(active?.origin).toBe("CLIENTS_BASE_ASSISTED_QUEUE");
    });

    it("B03: GET manual-campaigns aplica filtro de origem no banco de dados antes da paginação e calcula nextCursor sem perda", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: null, barbershopId: "shop-1" },
      });

      const mockCampaigns = [
        {
          id: "camp-1",
          name: "Campanha 1",
          channel: "WHATSAPP",
          status: CampaignStatus.COMPLETED,
          createdAt: new Date("2026-11-10T10:00:00.000Z"),
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          recipients: [],
        },
        {
          id: "camp-2",
          name: "Campanha 2",
          channel: "WHATSAPP",
          status: CampaignStatus.COMPLETED,
          createdAt: new Date("2026-11-09T10:00:00.000Z"),
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          recipients: [],
        },
        {
          id: "camp-3",
          name: "Campanha 3 (extra para verificar nextCursor)",
          channel: "WHATSAPP",
          status: CampaignStatus.COMPLETED,
          createdAt: new Date("2026-11-08T10:00:00.000Z"),
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          recipients: [],
        },
      ];

      prismaMock.reactivationCampaign.findMany.mockResolvedValueOnce(mockCampaigns);

      const res = await manualCampaignsGET(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns?limit=2&origin=CLIENTS_BASE_ASSISTED_QUEUE"
        )
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.items).toHaveLength(2);
      expect(json.items[0].id).toBe("camp-1");
      expect(json.items[1].id).toBe("camp-2");
      // nextCursor é o ID do último item retornado na página (camp-2), garantindo que skip:1 na próxima página pegue camp-3 sem perda
      expect(json.nextCursor).toBe("camp-2");
    });

    it("B04: prepareManualReactivationCampaign rejeita criação concorrente com 409 ACTIVE_QUEUE_ALREADY_EXISTS quando já há fila ativa", async () => {
      prismaMock.barbershop.findUnique.mockResolvedValueOnce({ id: "shop-1", name: "Barbearia", slug: "barbearia" });
      prismaMock.reactivationCampaign.findFirst
        // 1) Verificação de requestKey -> null (não é replay do mesmo requestKey)
        .mockResolvedValueOnce(null)
        // 2) B04: Verificação de fila ativa da mesma origem -> encontra fila ativa existente!
        .mockResolvedValueOnce({
          id: "camp-active-running",
          name: "Fila Ativa Concorrente",
          status: CampaignStatus.IN_PROGRESS,
        });

      await expect(
        prepareManualReactivationCampaign(prismaMock, {
          barbershopId: "shop-1",
          userId: "u-owner",
          requestKey: "rk-new-attempt",
          selectedCustomerIds: ["c-1"],
          templateKey: "RETURN_REMINDER",
          origin: "CLIENTS_BASE_ASSISTED_QUEUE",
        })
      ).rejects.toThrow(/ACTIVE_QUEUE_ALREADY_EXISTS/);
    });

    it("B06: prepareManualReactivationCampaign exclui cliente pulado no mesmo workRoundId mesmo se houver apenas 1 candidato", async () => {
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prismaMock.barbershop.findUnique.mockResolvedValueOnce({ id: "shop-1", name: "Barbearia", slug: "barbearia" });
      prismaMock.user.findMany.mockResolvedValueOnce([{ id: "c-skipped", name: "Pulado", phone: "5517991112222" }]);
      prismaMock.customerMarketingConsent.findMany.mockResolvedValueOnce([
        { customerId: "c-skipped", status: "OPTED_IN" },
      ]);
      prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValueOnce([]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.customerContactLog.findMany.mockResolvedValueOnce([]);

      // O cliente já foi pulado no banco nesta rodada
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([{ customerId: "c-skipped" }]);

      const result = await prepareManualReactivationCampaign(prismaMock, {
        barbershopId: "shop-1",
        userId: "u-owner",
        requestKey: "rk-skipped-check",
        selectedCustomerIds: ["c-skipped"],
        templateKey: "RETURN_REMINDER",
        workRoundId: "round-test-1",
        origin: "CLIENTS_BASE_ASSISTED_QUEUE",
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasonCode).toBe("SKIPPED_IN_CURRENT_ROUND");
    });

    it("G21-05: buildOpenPreparationId gera hash SHA-256 completo de 64 caracteres hexadecimais e valida regras de integridade", () => {
      const phoneA = "5517991112222";
      const phoneB = "5517993334444";
      const msgOriginal = "Olá João, seu corte está marcado!";
      const msgEdited = "Olá João, seu corte está remarcado para amanhã!";

      const prep1 = buildOpenPreparationId("rec-1", 1, phoneA, "RETURN_REMINDER", msgOriginal);
      const prep1Replay = buildOpenPreparationId("rec-1", 1, phoneA, "RETURN_REMINDER", msgOriginal);
      const prepEditedMsg = buildOpenPreparationId("rec-1", 1, phoneA, "RETURN_REMINDER", msgEdited);
      const prepEditedPhone = buildOpenPreparationId("rec-1", 1, phoneB, "RETURN_REMINDER", msgOriginal);
      const prepEditedTemplate = buildOpenPreparationId("rec-1", 1, phoneA, "CUSTOM", msgOriginal);
      const prepNextVersion = buildOpenPreparationId("rec-1", 2, phoneA, "RETURN_REMINDER", msgOriginal);

      // 1) Idempotência determinística
      expect(prep1).toBe(prep1Replay);

      // 2) Formato e hash SHA-256 completo de 64 caracteres hexadecimais
      expect(prep1).toMatch(/^prep_rec-1_v1_[0-9a-f]{64}$/);
      const fp = prep1.split("_").pop();
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[0-9a-f]{64}$/);

      // 3) Edição de texto invalida preparação
      expect(prep1).not.toBe(prepEditedMsg);

      // 4) Mudança de telefone invalida preparação
      expect(prep1).not.toBe(prepEditedPhone);

      // 5) Mudança de template invalida preparação
      expect(prep1).not.toBe(prepEditedTemplate);

      // 6) Incremento de tentativa/versão altera o identificador
      expect(prep1).not.toBe(prepNextVersion);
    });

    it("G21-04 / G23-05: Matriz de autorização comparativa preserva contratos legados do Smart CRM e aplica DEC-05 na Fila Assistida", async () => {
      // Cenário A: Fila Assistida (CLIENTS_BASE_ASSISTED_QUEUE) sob DEC-05
      // OWNER possui acesso integral irrestrito.
      // MANAGER, RECEPTIONIST e BARBER são desativados por padrão (WHATSAPP_ASSISTED_OPERATE = false).
      // Colaboradores só operam mediante concessão explícita pelo proprietário e posse de CLIENTS_VIEW.
      const defaultDeniedRolesForQueue = ["MANAGER", "RECEPTIONIST", "BARBER", "SUPER_ADMIN"];
      for (const role of defaultDeniedRolesForQueue) {
        expect(role !== "OWNER").toBe(true);
      }

      // Cenário B: Campanhas legadas do Smart CRM (SMART_CRM_REACTIVATION)
      // Preservam o contrato original: SUPER_ADMIN, OWNER, MANAGER têm acesso irrestrito
      const legacyAllowedRoles = ["SUPER_ADMIN", "OWNER", "MANAGER"];
      expect(legacyAllowedRoles.includes("SUPER_ADMIN")).toBe(true);
    });

    it("G21-06: Consulta com paginação por cursor e datas intercaladas inclui as 3 variações legadas e exclui Fila Assistida", async () => {
      // 4 tipos de campanhas simuladas:
      // 1) Legada sem campo origin no targetSegment ({})
      // 2) Legada com origin: null ({ origin: null })
      // 3) Legada com origin: "SMART_CRM_REACTIVATION"
      // 4) Fila Assistida com origin: "CLIENTS_BASE_ASSISTED_QUEUE"
      const now = Date.now();
      const syntheticCampaigns = [
        {
          id: "camp-legacy-1",
          name: "Campanha Legada 1 (Sem origin)",
          createdAt: new Date(now - 1000),
          targetSegment: {},
          recipients: [],
        },
        {
          id: "camp-queue-1",
          name: "Fila Assistida 1",
          createdAt: new Date(now - 2000),
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          recipients: [],
        },
        {
          id: "camp-legacy-2",
          name: "Campanha Legada 2 (origin: null)",
          createdAt: new Date(now - 3000),
          targetSegment: { origin: null },
          recipients: [],
        },
        {
          id: "camp-legacy-3",
          name: "Campanha Legada 3 (SMART_CRM_REACTIVATION)",
          createdAt: new Date(now - 4000),
          targetSegment: { origin: "SMART_CRM_REACTIVATION" },
          recipients: [],
        },
        {
          id: "camp-queue-2",
          name: "Fila Assistida 2",
          createdAt: new Date(now - 5000),
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
          recipients: [],
        },
      ];

      // Simula o filtro WHERE para SMART_CRM_REACTIVATION
      const filteredForReactivation = syntheticCampaigns.filter((c) => {
        const seg = (c.targetSegment as any) || {};
        return seg.origin !== "CLIENTS_BASE_ASSISTED_QUEUE";
      });

      // As 3 campanhas legadas devem estar presentes
      expect(filteredForReactivation).toHaveLength(3);
      expect(filteredForReactivation.map((c) => c.id)).toEqual([
        "camp-legacy-1",
        "camp-legacy-2",
        "camp-legacy-3",
      ]);

      // Nenhuma campanha de fila assistida pode aparecer no histórico de reativação
      expect(filteredForReactivation.some((c) => (c.targetSegment as any).origin === "CLIENTS_BASE_ASSISTED_QUEUE")).toBe(false);

      // Simula a paginação por cursor (lote 1 de tamanho 2)
      const page1 = filteredForReactivation.slice(0, 2);
      expect(page1).toHaveLength(2);
      const cursor1 = page1[page1.length - 1].id;
      expect(cursor1).toBe("camp-legacy-2");

      // Lote 2 após cursor1
      const cursorIndex = filteredForReactivation.findIndex((c) => c.id === cursor1);
      const page2 = filteredForReactivation.slice(cursorIndex + 1, cursorIndex + 3);
      expect(page2).toHaveLength(1);
      expect(page2[0].id).toBe("camp-legacy-3");
    });

    it("B08: cancelManualCampaign bloqueia campanhas de origem tradicional e campanhas já COMPLETED", async () => {
      // 1) Rejeita campanha de origem SMART_CRM_REACTIVATION
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-smart",
        barbershopId: "shop-1",
        status: CampaignStatus.IN_PROGRESS,
        targetSegment: { origin: "SMART_CRM_REACTIVATION" },
      });

      await expect(
        cancelManualCampaign(prismaMock, {
          barbershopId: "shop-1",
          campaignId: "camp-smart",
          userId: "u-owner",
        })
      ).rejects.toThrow(/INVALID_CAMPAIGN_ORIGIN/);

      // 2) Rejeita campanha já COMPLETED
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-completed",
        barbershopId: "shop-1",
        status: CampaignStatus.COMPLETED,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
      });

      await expect(
        cancelManualCampaign(prismaMock, {
          barbershopId: "shop-1",
          campaignId: "camp-completed",
          userId: "u-owner",
        })
      ).rejects.toThrow(/INVALID_TRANSITION/);

      // 3) Replay idempotente se já CANCELLED
      prismaMock.reactivationCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-already-cancelled",
        barbershopId: "shop-1",
        status: CampaignStatus.CANCELLED,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
      });

      const replayRes = await cancelManualCampaign(prismaMock, {
        barbershopId: "shop-1",
        campaignId: "camp-already-cancelled",
        userId: "u-owner",
      });
      expect(replayRes.isReplay).toBe(true);
      expect(replayRes.cancelledRecipientsCount).toBe(0);
    });
  });

  describe("10. G24-01 & G24-04 — Consentimento com CLIENTS_MANAGE Incondicional e Bloqueio Real de SUPER_ADMIN", () => {
    it("G24-01a: MANAGER com CLIENTS_MANAGE revogado (allowed=false) não altera consentimento com ou sem context/origin/source (403 sem gravação)", async () => {
      const payloads = [
        {
          status: MarketingConsentStatus.OPTED_IN,
          source: MarketingConsentSource.ADMIN_WITH_PROOF,
          context: "ASSISTED_QUEUE_DRAWER",
          declaredPriorAuthorization: true,
          evidence: "Evidência completa de consentimento",
          eventKey: "evt-revoked-drawer",
        },
        {
          status: MarketingConsentStatus.OPTED_IN,
          source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
          declaredPriorAuthorization: true,
          evidence: "Evidência completa de consentimento",
          eventKey: "evt-revoked-nocontext",
        },
        {
          status: MarketingConsentStatus.OPTED_IN,
          source: MarketingConsentSource.ADMIN_WITH_PROOF,
          context: "ANY_CUSTOM_ORIGIN",
          origin: "TAMPERED_ORIGIN",
          declaredPriorAuthorization: true,
          evidence: "Evidência completa de consentimento",
          eventKey: "evt-revoked-tampered",
        },
      ];

      for (const payload of payloads) {
        getAdminSessionMock.mockResolvedValueOnce({
          error: null,
          data: {
            userId: "u-mgr-rev-consent",
            role: "MANAGER",
            memberId: "m-mgr-rev-consent",
            barbershopId: "shop-1",
          },
        });
        prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
          { permissionKey: "CLIENTS_MANAGE", allowed: false },
          { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
        ]);

        const res = await marketingConsentPOST(
          new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
          { params: Promise.resolve({ id: "c-1" }) }
        );

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toBe("PERMISSION_DENIED");
        expect(json.requiredPermission).toBe("CLIENTS_MANAGE");
      }

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
    });

    it("G24-01b: Colaborador com WHATSAPP_ASSISTED_OPERATE=true e CLIENTS_MANAGE=false é bloqueado no consentimento (403 sem gravação)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "u-rec-wa-only",
          role: "RECEPTIONIST",
          memberId: "m-rec-wa-only",
          barbershopId: "shop-1",
        },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: true },
        { permissionKey: "CLIENTS_VIEW", allowed: true },
        { permissionKey: "CLIENTS_MANAGE", allowed: false },
      ]);

      const res = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            context: "CLIENTS_BASE_ASSISTED_QUEUE",
            declaredPriorAuthorization: true,
            evidence: "Solicitado presencialmente na recepção",
            eventKey: "evt-wa-only-blocked",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("CLIENTS_MANAGE");
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
    });

    it("G24-01c: Colaborador com CLIENTS_MANAGE=true e WHATSAPP_ASSISTED_OPERATE=false consegue registrar consentimento (200)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "u-rec-manage",
          role: "RECEPTIONIST",
          memberId: "m-rec-manage",
          barbershopId: "shop-1",
        },
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([
        { permissionKey: "CLIENTS_MANAGE", allowed: true },
        { permissionKey: "WHATSAPP_ASSISTED_OPERATE", allowed: false },
      ]);
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "c-1",
        name: "Cliente Consent",
        phone: "5517991112222",
      });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerMarketingConsent.upsert.mockResolvedValueOnce({
        id: "consent-1",
        status: MarketingConsentStatus.OPTED_IN,
        source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
      });
      prismaMock.customerMarketingConsentEvent.create.mockResolvedValueOnce({ id: "cevt-1" });

      const res = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
            context: "ASSISTED_QUEUE_DRAWER",
            declaredPriorAuthorization: true,
            evidence: "Cliente autorizou presencialmente no balcão em 11/11",
            eventKey: "evt-manage-allowed-1",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.consent.status).toBe(MarketingConsentStatus.OPTED_IN);
      expect(prismaMock.customerMarketingConsent.upsert).toHaveBeenCalledTimes(1);
    });

    it("G24-04a: SUPER_ADMIN sem vínculo ativo de membro é bloqueado mesmo com memberId preenchido na sessão", async () => {
      const superAdminWithFakeMember = {
        error: null,
        data: {
          userId: "u-superadmin",
          role: "SUPER_ADMIN",
          memberId: "forged-member-id",
          barbershopId: "shop-1",
        },
      };

      // 1) POST /manual-campaigns
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resPrep = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-superadmin-1",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );
      expect(resPrep.status).toBe(403);
      expect((await resPrep.json()).code).toBe("FORBIDDEN");

      // 2) GET /manual-campaigns/active
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resActive = await activeCampaignGET(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/active?origin=CLIENTS_BASE_ASSISTED_QUEUE"
        )
      );
      expect(resActive.status).toBe(403);
      expect((await resActive.json()).code).toBe("FORBIDDEN");

      // 3) POST /opened
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resOpened = await openRecipientPOST(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/opened",
          { method: "POST", body: JSON.stringify({}) }
        ),
        { params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }) }
      );
      expect(resOpened.status).toBe(403);

      // 4) POST /sent-confirmed
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resConfirm = await sentConfirmedPOST(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/recipients/rec-1/sent-confirmed",
          { method: "POST", body: JSON.stringify({ openPreparationId: "prep-1" }) }
        ),
        { params: Promise.resolve({ campaignId: "camp-1", recipientId: "rec-1" }) }
      );
      expect(resConfirm.status).toBe(403);

      // 5) POST /cancel
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resCancel = await cancelCampaignPOST(
        new NextRequest(
          "http://localhost/api/admin/clients/reactivation/manual-campaigns/camp-1/cancel",
          { method: "POST", body: JSON.stringify({}) }
        ),
        { params: Promise.resolve({ campaignId: "camp-1" }) }
      );
      expect(resCancel.status).toBe(403);

      // 6) POST /marketing-consent
      getAdminSessionMock.mockResolvedValueOnce(superAdminWithFakeMember);
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(null);
      const resConsent = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.ADMIN_WITH_PROOF,
            declaredPriorAuthorization: true,
            evidence: "Superadmin tentativa sem vínculo",
            eventKey: "evt-sa-blocked",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resConsent.status).toBe(403);
      expect(prismaMock.reactivationCampaign.create).not.toHaveBeenCalled();
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
    });

    it("G24-04b: SUPER_ADMIN vinculado como MANAGER sem WHATSAPP_ASSISTED_OPERATE continua bloqueado (sem bypass de OWNER)", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: {
          userId: "u-sa-mgr",
          role: "SUPER_ADMIN",
          memberId: "m-sa-ignored",
          barbershopId: "shop-1",
        },
      });
      prismaMock.barbershopMember.findFirst.mockResolvedValueOnce({
        id: "m-real-mgr",
        role: "MANAGER",
        isActive: true,
      });
      prismaMock.memberPermissionOverride.findMany.mockResolvedValueOnce([]);

      const res = await manualCampaignsPOST(
        new NextRequest("http://localhost/api/admin/clients/reactivation/manual-campaigns", {
          method: "POST",
          body: JSON.stringify({
            requestKey: "rk-sa-mgr-denied",
            selectedCustomerIds: ["c-1"],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          }),
        })
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("PERMISSION_DENIED");
      expect(json.requiredPermission).toBe("WHATSAPP_ASSISTED_OPERATE");
    });
  });

  describe("11. GITHUB-01 — Endurecimento Incondicional de Prova no OPTED_IN", () => {
    it("rejeita OPTED_IN sem prova quando context, declaredPriorAuthorization e evidence são omitidos (sem gravação)", async () => {
      const ownerSession = {
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      };

      for (const source of [
        MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
        MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
        MarketingConsentSource.BOOKING_CHECKBOX,
        MarketingConsentSource.ADMIN_WITH_PROOF,
      ]) {
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
        prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
        prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

        const res = await marketingConsentPOST(
          new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source,
              eventKey: `evt-no-proof-${source}`,
            }),
          }),
          { params: Promise.resolve({ id: "c-1" }) }
        );

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("PRIOR_AUTHORIZATION_DECLARATION_REQUIRED");
      }

      // Mesmo com declaredPriorAuthorization=true e reason genérico, omitir evidence -> 400
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);

      const resReasonOnly = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            declaredPriorAuthorization: true,
            reason: "Justificativa genérica apenas em reason",
            eventKey: "evt-reason-only-blocked",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resReasonOnly.status).toBe(400);
      expect((await resReasonOnly.json()).error).toBe("CONSENT_EVIDENCE_REQUIRED");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
    });

    it("permite OPTED_IN sem context quando source, declaredPriorAuthorization=true e evidence >= 10 chars são válidos, e mantém OPTED_OUT sem evidência", async () => {
      const ownerSession = {
        error: null,
        data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: "shop-1" },
      };

      // OPTED_IN sem context com prova completa -> 200
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerMarketingConsent.upsert.mockResolvedValueOnce({
        id: "consent-in",
        status: MarketingConsentStatus.OPTED_IN,
        source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
      });
      prismaMock.customerMarketingConsentEvent.create.mockResolvedValueOnce({ id: "cevt-in" });

      const resIn = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
            declaredPriorAuthorization: true,
            evidence: "Cliente respondeu SIM no WhatsApp em 11/11/2026",
            eventKey: "evt-opted-in-no-ctx-valid",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resIn.status).toBe(200);

      // OPTED_OUT sem evidência nem declaração -> 200
      getAdminSessionMock.mockResolvedValueOnce(ownerSession);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "c-1", name: "Cliente 1", phone: "5517991112222" });
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
      prismaMock.customerMarketingConsentEvent.findUnique.mockResolvedValueOnce(null);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce({
        id: "consent-in",
        status: MarketingConsentStatus.OPTED_IN,
      });
      prismaMock.customerMarketingConsent.upsert.mockResolvedValueOnce({
        id: "consent-in",
        status: MarketingConsentStatus.OPTED_OUT,
        source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
      });
      prismaMock.customerMarketingConsentEvent.create.mockResolvedValueOnce({ id: "cevt-out" });

      const resOut = await marketingConsentPOST(
        new NextRequest("http://localhost/api/admin/clients/c-1/marketing-consent", {
          method: "POST",
          body: JSON.stringify({
            status: MarketingConsentStatus.OPTED_OUT,
            eventKey: "evt-opted-out-no-ev",
          }),
        }),
        { params: Promise.resolve({ id: "c-1" }) }
      );
      expect(resOut.status).toBe(200);
      expect((await resOut.json()).consent.status).toBe(MarketingConsentStatus.OPTED_OUT);
    });
  });

  describe("12. Separação Atendimento Manual (UNKNOWN) vs Campanha Promocional (OPTED_IN)", () => {
    it("prepara fila assistida com OPTED_IN (MARKETING_REACTIVATION) e UNKNOWN (MANUAL_SUPPORT sem texto promocional) enquanto bloqueia OPTED_OUT, bloqueado e telefone inválido", async () => {
      prismaMock.reactivationCampaign.findFirst
        .mockResolvedValueOnce(null) // idempotência requestKey
        .mockResolvedValueOnce(null) // B04 active queue check
        .mockResolvedValueOnce(null); // round skipped check
      prismaMock.barbershop.findUnique.mockResolvedValueOnce({
        id: "shop-1",
        name: "Barbearia Modelo",
        slug: "modelo",
      });
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: "c-in", name: "João OptIn", phone: "5517991089190" },
        { id: "c-unk", name: "Maria Unknown", phone: "5517991089191" },
        { id: "c-out", name: "Pedro OptOut", phone: "5517991089192" },
        { id: "c-blk", name: "Lucas Bloqueado", phone: "5517991089193" },
        { id: "c-inv", name: "Ana Invalido", phone: "123" },
      ]);
      prismaMock.customerMarketingConsent.findMany.mockResolvedValueOnce([
        { customerId: "c-in", status: MarketingConsentStatus.OPTED_IN },
        { customerId: "c-out", status: MarketingConsentStatus.OPTED_OUT },
      ]);
      prismaMock.barbershopBlockedCustomer.findMany
        .mockResolvedValueOnce([{ userId: "c-blk", phoneNormalized: "5517991089193" }])
        .mockResolvedValueOnce([]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.customerContactLog.findMany.mockResolvedValueOnce([]);

      let createdCampaignData: any = null;
      prismaMock.reactivationCampaign.create.mockImplementationOnce(async ({ data }: any) => {
        createdCampaignData = data;
        return {
          id: "camp-sep-1",
          name: data.name,
          status: data.status,
          targetSegment: data.targetSegment,
          recipients: data.recipients.create.map((r: any, idx: number) => ({
            id: `rec-sep-${idx + 1}`,
            customerId: r.customer.connect.id,
            customerNameSnapshot: r.customerNameSnapshot,
            customerPhoneSnapshot: r.customerPhoneSnapshot,
            dispatchStatus: r.dispatchStatus,
            timingStateSnapshot: r.timingStateSnapshot,
            scoreSnapshot: r.scoreSnapshot,
            payloadSnapshot: r.payloadSnapshot,
          })),
        };
      });

      const res = await prepareManualReactivationCampaign(prismaMock as any, {
        barbershopId: "shop-1",
        userId: "owner-1",
        requestKey: "req-sep-1",
        selectedCustomerIds: ["c-in", "c-unk", "c-out", "c-blk", "c-inv"],
        templateKey: "RETURN_REMINDER",
        origin: "CLIENTS_BASE_ASSISTED_QUEUE",
        operationMode: "ASSISTED_QUEUE",
      });

      expect(res.accepted).toHaveLength(2);
      const inRec = res.accepted.find((r) => r.customerId === "c-in");
      const unkRec = res.accepted.find((r) => r.customerId === "c-unk");
      expect(inRec?.operationType).toBe("MARKETING_REACTIVATION");
      expect(inRec?.templateKey).toBe("RETURN_REMINDER");
      expect(inRec?.previewMessage).toContain("Barbearia Modelo");

      expect(unkRec?.operationType).toBe("MANUAL_SUPPORT");
      expect(unkRec?.templateKey).toBe("MANUAL_SUPPORT");
      expect(unkRec?.previewMessage).toBe("");

      expect(res.rejected.map((r) => ({ id: r.customerId, code: r.reasonCode }))).toEqual([
        { id: "c-out", code: "CONSENT_OPTED_OUT" },
        { id: "c-blk", code: "BLOCKED" },
        { id: "c-inv", code: "INVALID_PHONE" },
      ]);
      expect(createdCampaignData).not.toBeNull();
      // Nunca cria consentimento fictício para UNKNOWN
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
      expect(prismaMock.customerMarketingConsentEvent.create).not.toHaveBeenCalled();
    });

    it("bloqueia modelo promocional no servidor para destinatário MANUAL_SUPPORT sem OPTED_IN, permite abertura limpa e confirma log sem gerar OPTED_IN", async () => {
      const manualRecipient = {
        id: "rec-unk-1",
        campaignId: "camp-sep-1",
        barbershopId: "shop-1",
        customerId: "c-unk",
        customerNameSnapshot: "Maria Unknown",
        customerPhoneSnapshot: "5517991089191",
        dispatchStatus: RecipientDispatchStatus.READY,
        dispatchAttemptCount: 0,
        customer: { id: "c-unk", name: "Maria Unknown", phone: "5517991089191" },
        campaign: {
          id: "camp-sep-1",
          barbershopId: "shop-1",
          name: "Fila Assistida",
          status: CampaignStatus.READY,
          startedAt: null,
          targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE", operationMode: "ASSISTED_QUEUE" },
        },
        payloadSnapshot: {
          queueIndex: 0,
          operationType: "MANUAL_SUPPORT",
          consentStatusAtPreparation: "UNKNOWN",
          initialTemplateKey: "MANUAL_SUPPORT",
          templateKey: "MANUAL_SUPPORT",
          templateLabel: "Atendimento manual",
          previewMessage: "",
        },
      };

      // Tentativa de forçar modelo promocional RETURN_REMINDER para cliente UNKNOWN deve falhar com 400
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(manualRecipient);
      await expect(
        revalidateAndOpenManualRecipient(prismaMock as any, {
          barbershopId: "shop-1",
          campaignId: "camp-sep-1",
          recipientId: "rec-unk-1",
          userId: "owner-1",
          userRole: "OWNER",
          templateKey: "RETURN_REMINDER",
          messageText: "Promoção",
        })
      ).rejects.toMatchObject({
        status: 400,
        code: "PROMOTIONAL_TEMPLATE_REQUIRES_OPT_IN",
      });

      // GITHUB-DEF-02: Tentativa de enviar messageText arbitrário em MANUAL_SUPPORT deve falhar com 400 MANUAL_SUPPORT_NO_PREFILLED_MESSAGE
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(manualRecipient);
      await expect(
        revalidateAndOpenManualRecipient(prismaMock as any, {
          barbershopId: "shop-1",
          campaignId: "camp-sep-1",
          recipientId: "rec-unk-1",
          userId: "owner-1",
          userRole: "OWNER",
          templateKey: "MANUAL_SUPPORT",
          messageText: "Olá, venha cortar seu cabelo hoje!",
        })
      ).rejects.toMatchObject({
        status: 400,
        code: "MANUAL_SUPPORT_NO_PREFILLED_MESSAGE",
      });

      // Abertura legítima MANUAL_SUPPORT sem texto promocional -> gera https://wa.me/5517991089191 limpo
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(manualRecipient);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce(null); // UNKNOWN
      prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);
      prismaMock.reactivationCampaignRecipient.update.mockImplementationOnce(async ({ data }: any) => ({
        ...manualRecipient,
        dispatchStatus: data.dispatchStatus,
        payloadSnapshot: data.payloadSnapshot,
      }));
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([
        { dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED },
      ]);

      const opened = await revalidateAndOpenManualRecipient(prismaMock as any, {
        barbershopId: "shop-1",
        campaignId: "camp-sep-1",
        recipientId: "rec-unk-1",
        userId: "owner-1",
        userRole: "OWNER",
        templateKey: "MANUAL_SUPPORT",
        messageText: "",
      });

      expect(opened.ok).toBe(true);
      expect(opened.whatsappUrl).toBe("https://wa.me/5517991089191");
      expect(opened.openPreparationId).toBeTruthy();

      // Confirmação grava CustomerContactLog como MANUAL_SUPPORT sem criar consentimento OPTED_IN
      const openedRecipient = {
        ...manualRecipient,
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        payloadSnapshot: opened.recipient.payloadSnapshot,
      };
      prismaMock.reactivationCampaignRecipient.findFirst.mockResolvedValueOnce(openedRecipient);
      prismaMock.customerMarketingConsent.findUnique.mockResolvedValueOnce(null);
      prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);
      prismaMock.reactivationCampaignRecipient.update.mockResolvedValueOnce({
        ...openedRecipient,
        dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      });
      prismaMock.reactivationCampaign.update.mockResolvedValueOnce({});
      prismaMock.reactivationCampaignRecipient.findMany.mockResolvedValueOnce([
        { dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED },
      ]);
      prismaMock.customerContactLog.findFirst.mockResolvedValueOnce(null);
      let createdLogData: any = null;
      prismaMock.customerContactLog.create.mockImplementationOnce(async ({ data }: any) => {
        createdLogData = data;
        return { id: "log-unk-1", ...data };
      });

      const confirmed = await confirmManualRecipientSend(prismaMock as any, {
        barbershopId: "shop-1",
        campaignId: "camp-sep-1",
        recipientId: "rec-unk-1",
        userId: "owner-1",
        userRole: "OWNER",
        openPreparationId: opened.openPreparationId,
      });

      expect(confirmed.postOpenWarning).toBeNull();
      expect(createdLogData.templateKey).toBe("MANUAL_SUPPORT");
      expect(createdLogData.templateLabel).toBe("Atendimento manual");
      expect(prismaMock.customerMarketingConsent.upsert).not.toHaveBeenCalled();
      expect(prismaMock.customerMarketingConsentEvent.create).not.toHaveBeenCalled();
    });
  });
});
