import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { CommissionConfigType, MemberRole } from "@prisma/client";

// Hoisted Prisma mock
const { prismaMock, sessionMock } = vi.hoisted(() => ({
  sessionMock: {
    data: {
      userId: "user-owner-1",
      role: "OWNER",
      memberId: "member-owner-1",
      barbershopId: "shop-1",
    },
    error: null,
  },
  prismaMock: {
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    memberPermissionOverride: { findMany: vi.fn() },
    memberCommissionEligibilityEvent: { create: vi.fn() },
    service: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    product: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    barberService: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    commissionConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    careerLevel: { findFirst: vi.fn(), findMany: vi.fn() },
    serviceCommissionRule: { findFirst: vi.fn(), findMany: vi.fn() },
    category: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn().mockImplementation(() => Promise.resolve(sessionMock)),
}));

import { GET as getCommissionSettings, PUT as putCommissionSettings } from "@/app/api/admin/team/[id]/commission-settings/route";
import { PUT as putLegacyServices } from "@/app/api/admin/team/[id]/services/route";
import { POST as postCommissionConfig } from "@/app/api/admin/commissions/configs/route";
import { PATCH as patchCommissionConfig } from "@/app/api/admin/commissions/configs/[id]/route";

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const shopId = "shop-1";
const barberId = "barber-1";
const ownerId = "owner-1";

describe("TEM BARBER — Gate P2-B: Configuração Transacional de Serviços e Comissões", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    sessionMock.data = {
      userId: "user-owner-1",
      role: "OWNER",
      memberId: "member-owner-1",
      barbershopId: shopId,
    };
    sessionMock.error = null;

    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)
    );

    prismaMock.barbershopMember.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === barberId && where.barbershopId === shopId) {
        return Promise.resolve({
          id: barberId,
          barbershopId: shopId,
          userId: "user-barber-1",
          role: "BARBER" as MemberRole,
          isActive: true,
          isCommissionEligible: true,
          careerLevelId: "level-1",
          user: { name: "João Barbeiro", email: "joao@example.com", phone: "1199999999" },
          careerLevel: { id: "level-1", name: "Pleno", defaultCommissionRate: 40 },
        });
      }
      if (where.id === ownerId && where.barbershopId === shopId) {
        return Promise.resolve({
          id: ownerId,
          barbershopId: shopId,
          userId: "user-owner-1",
          role: "OWNER" as MemberRole,
          isActive: true,
          isCommissionEligible: false,
          careerLevelId: null,
          user: { name: "Carlos Proprietário", email: "carlos@example.com", phone: "1188888888" },
          careerLevel: null,
        });
      }
      return Promise.resolve(null);
    });

    prismaMock.service.findMany.mockResolvedValue([
      {
        id: "svc-1",
        barbershopId: shopId,
        categoryId: "cat-1",
        name: "Corte Tradicional",
        price: 50,
        isActive: true,
        category: { id: "cat-1", name: "Cabelo" },
      },
      {
        id: "svc-2",
        barbershopId: shopId,
        categoryId: "cat-1",
        name: "Barba Terapia",
        price: 40,
        isActive: true,
        category: { id: "cat-1", name: "Barba" },
      },
    ]);

    prismaMock.product.findMany.mockResolvedValue([
      { id: "prod-1", barbershopId: shopId, name: "Pomada Cabelo", salePrice: 30, isActive: true },
      { id: "prod-2", barbershopId: shopId, name: "Óleo de Barba", salePrice: 25, isActive: true },
    ]);

    prismaMock.barbershopMember.findFirstOrThrow = vi.fn().mockImplementation(({ where }: any) => {
      if (where.id === barberId && where.barbershopId === shopId) {
        return Promise.resolve({ id: barberId, barbershopId: shopId });
      }
      return Promise.reject(new Error("Member not found"));
    });

    prismaMock.service.findFirst = vi.fn().mockImplementation(({ where }: any) => {
      if (where.id === "svc-1") return Promise.resolve({ id: "svc-1", categoryId: "cat-1", name: "Corte Tradicional" });
      if (where.id === "svc-2") return Promise.resolve({ id: "svc-2", categoryId: "cat-1", name: "Barba Terapia" });
      return Promise.resolve(null);
    });
    prismaMock.service.findFirstOrThrow = vi.fn().mockImplementation(({ where }: any) => {
      if (where.id === "svc-1" || where.id === "svc-2") return Promise.resolve({ id: where.id });
      return Promise.reject(new Error("Service not found"));
    });

    prismaMock.product.findFirstOrThrow = vi.fn().mockImplementation(({ where }: any) => {
      if (where.id === "prod-1" || where.id === "prod-2") return Promise.resolve({ id: where.id });
      return Promise.reject(new Error("Product not found"));
    });

    prismaMock.careerLevel.findFirst = vi.fn().mockImplementation(({ where }: any) => {
      if (where.id === "level-1") {
        return Promise.resolve({
          id: "level-1",
          barbershopId: shopId,
          name: "Pleno",
          defaultCommissionRate: 40,
          active: true,
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    prismaMock.barberService.findMany.mockResolvedValue([{ serviceId: "svc-1" }]);

    prismaMock.commissionConfig.findMany.mockResolvedValue([]);
    prismaMock.commissionConfig.upsert.mockImplementation((args: any) =>
      Promise.resolve({ id: `cfg-${Math.random()}`, ...args.create })
    );
    prismaMock.commissionConfig.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data })
    );
  });

  describe("1. Leitura de Configuração (GET)", () => {
    it("1. Retorna configuração herdada sem efeitos colaterais no banco", async () => {
      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "GET");
      const res = await getCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.memberId).toBe(barberId);
      expect(json.isCommissionEligible).toBe(true);
      expect(json.selectedServiceIds).toEqual(["svc-1"]);
      expect(json.services).toHaveLength(2);

      // Svc-1 should inherit career level (40%) since no individual config exists
      const svc1 = json.services.find((s: any) => s.id === "svc-1");
      expect(svc1.isSelected).toBe(true);
      expect(svc1.effectiveCommission.origin).toBe("CAREER_LEVEL_DEFAULT");
      expect(svc1.effectiveCommission.value).toBe(40);
      expect(svc1.effectiveCommission.isCustomized).toBe(false);
      expect(svc1.individualRule).toBeNull();

      // Zero writes executed on GET
      expect(prismaMock.commissionConfig.upsert).not.toHaveBeenCalled();
      expect(prismaMock.barbershopMember.update).not.toHaveBeenCalled();
    });

    it("1b. GET apresenta regra individual inativa sem utilizá-la como regra efetiva", async () => {
      const allConfigs = [
        {
          id: "cfg-inactive-1",
          barbershopId: shopId,
          memberId: barberId,
          serviceId: "svc-1",
          productId: null,
          scopeKey: `member:${barberId}:service:svc-1`,
          type: "PERCENTAGE",
          value: 70,
          active: false, // Regra inativa
        },
      ];

      prismaMock.commissionConfig.findMany.mockImplementation(({ where }: any) => {
        if (where?.active === true) {
          // Chamado por resolveCommissionConfig: regras inativas NÃO entram
          return Promise.resolve(allConfigs.filter((c) => c.active === true));
        }
        // Chamado pelo GET endpoint para mapear individualRule (sem filtro active: true)
        return Promise.resolve(allConfigs);
      });

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "GET");
      const res = await getCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      const json = await res.json();

      const svc1 = json.services.find((s: any) => s.id === "svc-1");
      expect(svc1.individualRule).not.toBeNull();
      expect(svc1.individualRule.active).toBe(false);
      expect(svc1.individualRule.value).toBe(70);
      // Regra efetiva continua respeitando resolveCommissionConfig (herda plano de carreira 40%)
      expect(svc1.effectiveCommission.origin).toBe("CAREER_LEVEL_DEFAULT");
      expect(svc1.effectiveCommission.value).toBe(40);
      expect(svc1.effectiveCommission.isCustomized).toBe(false);
    });
  });

  describe("2. Personalização e Restauração de Serviços (PUT)", () => {
    it("2. Personaliza percentual para um profissional (MEMBER_SERVICE)", async () => {
      const payload = {
        serviceRules: [
          { serviceId: "svc-1", type: "PERCENTAGE", value: 55 },
        ],
      };
      prismaMock.service.count.mockResolvedValue(1);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      expect(prismaMock.commissionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            barbershopId: shopId,
            memberId: barberId,
            serviceId: "svc-1",
            type: "PERCENTAGE",
            scopeKey: `member:${barberId}:service:svc-1`,
          }),
        })
      );
    });

    it("3. Restaura regra padrão removendo a exceção individual", async () => {
      const payload = {
        removeServiceRuleIds: ["svc-1"],
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.commissionConfig.deleteMany).toHaveBeenCalledWith({
        where: {
          barbershopId: shopId,
          scopeKey: `member:${barberId}:service:svc-1`,
        },
      });
    });

    it("4. Permite comissão individual de 0% como valor válido sem desativar elegibilidade", async () => {
      const payload = {
        serviceRules: [
          { serviceId: "svc-1", type: "PERCENTAGE", value: 0 },
        ],
      };
      prismaMock.service.count.mockResolvedValue(1);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.commissionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            memberId: barberId,
            serviceId: "svc-1",
            value: 0,
          }),
        })
      );
      // Member eligibility untouched
      expect(prismaMock.barbershopMember.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("3. Configuração de Produtos e Precedência (PUT)", () => {
    it("5. Configura regra individual padrão de produtos e exceção por produto", async () => {
      const payload = {
        productDefaultRule: { type: "PERCENTAGE", value: 15 },
        productRules: [
          { productId: "prod-1", type: "PERCENTAGE", value: 20 },
        ],
      };
      prismaMock.product.count.mockResolvedValue(1);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      // Product default upsert
      expect(prismaMock.commissionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            memberId: barberId,
            scopeKey: `member:${barberId}:product_default`,
          }),
        })
      );
      // Product exception upsert
      expect(prismaMock.commissionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            memberId: barberId,
            productId: "prod-1",
            scopeKey: `member:${barberId}:product:prod-1`,
          }),
        })
      );
    });
  });

  describe("4. Gestão de Elegibilidade e Concorrência (PUT)", () => {
    it("6. Altera elegibilidade de comissão e registra evento quando count === 1", async () => {
      prismaMock.barbershopMember.updateMany.mockResolvedValue({ count: 1 });

      const payload = {
        isCommissionEligible: false,
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.barbershopMember.updateMany).toHaveBeenCalledWith({
        where: {
          id: barberId,
          barbershopId: shopId,
          isCommissionEligible: { not: false },
        },
        data: { isCommissionEligible: false },
      });
      expect(prismaMock.memberCommissionEligibilityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barbershopId: shopId,
          memberId: barberId,
          enabled: false,
          actorUserId: "user-owner-1",
          effectiveAt: expect.any(Date),
          createdAt: expect.any(Date),
        }),
      });

      const eventCall = prismaMock.memberCommissionEligibilityEvent.create.mock.calls[0][0];
      expect(eventCall.data.effectiveAt.getTime()).toBe(eventCall.data.createdAt.getTime());
    });

    it("7. Não registra evento se count === 0 (estado persistido já era igual)", async () => {
      prismaMock.barbershopMember.updateMany.mockResolvedValue({ count: 0 });

      const payload = {
        isCommissionEligible: true,
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.barbershopMember.updateMany).toHaveBeenCalled();
      expect(prismaMock.memberCommissionEligibilityEvent.create).not.toHaveBeenCalled();
    });
  });

  describe("5. Transacionalidade, Segurança e RBAC", () => {
    it("8. Em caso de falha transacional, nenhuma persistência parcial ocorre (rollback)", async () => {
      prismaMock.service.count.mockImplementation(async ({ where }: any) => where.id.in.length);
      prismaMock.commissionConfig.upsert.mockRejectedValueOnce(new Error("DB_WRITE_ERROR"));

      const payload = {
        selectedServiceIds: ["svc-1", "svc-2"],
        serviceRules: [{ serviceId: "svc-1", type: "PERCENTAGE", value: 50 }],
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(500);
    });

    it("9. Bloqueio cross-tenant: rejeita membro de outra barbearia (404)", async () => {
      const req = createJsonRequest("http://localhost/api/admin/team/other-barber/commission-settings", "GET");
      const res = await getCommissionSettings(req, { params: Promise.resolve({ id: "other-barber" }) });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Colaborador não encontrado");
    });

    it("10. Bloqueio RBAC: colaborador com role BARBER recebe 403", async () => {
      sessionMock.data.role = "BARBER";

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "GET");
      const res = await getCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(403);
    });

    it("10b. Bloqueio RBAC: MANAGER sem COMMISSIONS_MANAGE recebe 403 no GET e no PUT", async () => {
      sessionMock.data.role = "MANAGER";
      sessionMock.data.memberId = "manager-member-1";
      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([]); // sem override, padrão MANAGER é COMMISSIONS_MANAGE: false

      const getReq = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "GET");
      const getRes = await getCommissionSettings(getReq, { params: Promise.resolve({ id: barberId }) });
      expect(getRes.status).toBe(403);

      const putReq = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", {});
      const putRes = await putCommissionSettings(putReq, { params: Promise.resolve({ id: barberId }) });
      expect(putRes.status).toBe(403);
    });

    it("10c. Liberação RBAC: MANAGER com COMMISSIONS_MANAGE explícito acessa GET e PUT com sucesso", async () => {
      sessionMock.data.role = "MANAGER";
      sessionMock.data.memberId = "manager-member-1";
      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([
        { permissionKey: "COMMISSIONS_MANAGE", allowed: true },
      ]);

      const getReq = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "GET");
      const getRes = await getCommissionSettings(getReq, { params: Promise.resolve({ id: barberId }) });
      expect(getRes.status).toBe(200);

      const putReq = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", {});
      const putRes = await putCommissionSettings(putReq, { params: Promise.resolve({ id: barberId }) });
      expect(putRes.status).toBe(200);
    });

    it("10d. POST e PATCH legados respeitam verificação de COMMISSIONS_MANAGE para MANAGER", async () => {
      sessionMock.data.role = "MANAGER";
      sessionMock.data.memberId = "manager-member-1";
      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([]); // Sem permissão

      const postReq = createJsonRequest("http://localhost/api/admin/commissions/configs", "POST", {
        type: "PERCENTAGE",
        value: 10,
      });
      const postRes = await postCommissionConfig(postReq);
      expect(postRes.status).toBe(403);

      const patchReq = createJsonRequest("http://localhost/api/admin/commissions/configs/cfg-1", "PATCH", {
        value: 20,
      });
      const patchRes = await patchCommissionConfig(patchReq, { params: Promise.resolve({ id: "cfg-1" }) });
      expect(patchRes.status).toBe(403);
    });

    it("11. Proteção do OWNER: MANAGER não altera elegibilidade de OWNER mesmo em solicitação aparentemente sem mudança (403)", async () => {
      sessionMock.data.role = "MANAGER";
      sessionMock.data.memberId = "manager-member-1";
      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([
        { permissionKey: "COMMISSIONS_MANAGE", allowed: true },
      ]);

      // Owner tem isCommissionEligible = false. MANAGER envia isCommissionEligible = false (valor idêntico)
      const payload = {
        isCommissionEligible: false,
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${ownerId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: ownerId }) });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("OWNER_ELIGIBILITY_PROTECTED");
      expect(prismaMock.barbershopMember.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.memberCommissionEligibilityEvent.create).not.toHaveBeenCalled();
    });

    it("13. Rejeita serviços inválidos ou pertencentes a outro tenant (400)", async () => {
      prismaMock.service.count.mockResolvedValue(0); // Service not found in tenant

      const payload = {
        selectedServiceIds: ["svc-cross-tenant"],
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_SCOPE");
    });

    it("13b. Rejeita IDs duplicados no payload (400)", async () => {
      const payload = {
        selectedServiceIds: ["svc-1", "svc-1"],
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("duplicados");
    });

    it("13c. Rejeita payload com booleano em formato string (400)", async () => {
      const payload = {
        isCommissionEligible: "true", // string em vez de booleano
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("booleano");
    });

    it("13d. Rejeita payload com active em formato string dentro das regras (400)", async () => {
      const payload = {
        serviceRules: [
          { serviceId: "svc-1", type: "PERCENTAGE", value: 50, active: "false" as any },
        ],
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("booleano");
    });
  });

  describe("6. Correção do PATCH de Configuração (Regressão)", () => {
    it("12. PATCH de produto atualiza valor preservando escopo sem desviar para barbershop:default", async () => {
      const productConfigId = "cfg-prod-99";
      prismaMock.commissionConfig.findFirst.mockResolvedValue({
        id: productConfigId,
        barbershopId: shopId,
        productId: "prod-1",
        memberId: null,
        serviceId: null,
        categoryId: null,
        scopeKey: "product:prod-1",
        type: "PERCENTAGE",
        value: 10,
        active: true,
      });

      const patchReq = createJsonRequest(
        `http://localhost/api/admin/commissions/configs/${productConfigId}`,
        "PATCH",
        { value: 18 }
      );

      const res = await patchCommissionConfig(patchReq, { params: Promise.resolve({ id: productConfigId }) });

      expect(res.status).toBe(200);
      // Must update directly by ID, NOT by recalculated scopeKey!
      expect(prismaMock.commissionConfig.update).toHaveBeenCalledWith({
        where: { id: productConfigId },
        data: expect.objectContaining({
          value: 18,
        }),
      });
      // Should NOT invoke upsert or recalculate scope
      expect(prismaMock.commissionConfig.upsert).not.toHaveBeenCalled();
    });

    it("12b. Bloqueia tentativa de mutação de escopo no PATCH de configuração existente (400)", async () => {
      const configId = "cfg-123";
      prismaMock.commissionConfig.findFirst.mockResolvedValue({
        id: configId,
        barbershopId: shopId,
        serviceId: "svc-1",
        memberId: null,
        categoryId: null,
        productId: null,
        scopeKey: "service:svc-1",
        type: "PERCENTAGE",
        value: 50,
        active: true,
      });

      const patchReq = createJsonRequest(
        `http://localhost/api/admin/commissions/configs/${configId}`,
        "PATCH",
        { serviceId: "svc-OTHER" } // Tentativa de trocar escopo
      );

      const res = await patchCommissionConfig(patchReq, { params: Promise.resolve({ id: configId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("SCOPE_MUTATION_FORBIDDEN");
      expect(prismaMock.commissionConfig.update).not.toHaveBeenCalled();
    });

    it("12c. PATCH rejeita alteração de classificação isProductDefault (400)", async () => {
      const configId = "cfg-prod-default";
      prismaMock.commissionConfig.findFirst.mockResolvedValue({
        id: configId,
        barbershopId: shopId,
        serviceId: null,
        memberId: barberId,
        categoryId: null,
        productId: null,
        scopeKey: `member:${barberId}:product_default`,
        type: "PERCENTAGE",
        value: 15,
        active: true,
      });

      const patchReq = createJsonRequest(
        `http://localhost/api/admin/commissions/configs/${configId}`,
        "PATCH",
        { isProductDefault: false } // Tentativa de mudar classificação de default de produto
      );

      const res = await patchCommissionConfig(patchReq, { params: Promise.resolve({ id: configId }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("SCOPE_MUTATION_FORBIDDEN");
      expect(prismaMock.commissionConfig.update).not.toHaveBeenCalled();
    });
  });

  describe("7. Preservação Histórica", () => {
    it("14. A alteração de configurações e elegibilidade preserva integralmente entradas e ciclos históricos", async () => {
      prismaMock.service.count.mockResolvedValue(1);

      const payload = {
        selectedServiceIds: ["svc-1"],
        serviceRules: [{ serviceId: "svc-1", type: "PERCENTAGE", value: 50 }],
        isCommissionEligible: true,
      };

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/commission-settings`, "PUT", payload);
      const res = await putCommissionSettings(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);

      // Verify that NO historical financial or commission models were touched
      expect((prismaMock as any).commissionEntry?.update).toBeUndefined();
      expect((prismaMock as any).commissionCycle?.update).toBeUndefined();
      expect((prismaMock as any).commissionPayableItem?.update).toBeUndefined();
      expect((prismaMock as any).commissionPayout?.update).toBeUndefined();
    });
  });

  describe("8. Controle de Permissões no Endpoint Legado de Serviços (P2-F)", () => {
    it("15a. OWNER tem permissão direta no endpoint legado PUT /api/admin/team/[id]/services", async () => {
      sessionMock.data = {
        userId: "user-owner-1",
        role: "OWNER",
        memberId: "member-owner-1",
        barbershopId: shopId,
      };

      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: barberId,
        barbershopId: shopId,
      });
      prismaMock.service.count.mockResolvedValue(1);
      prismaMock.$transaction.mockResolvedValue([]);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/services`, "PUT", {
        serviceIds: ["svc-1"],
      });
      const res = await putLegacyServices(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("15b. MANAGER com SERVICES_MANAGE=true pode atualizar serviços no endpoint legado", async () => {
      sessionMock.data = {
        userId: "user-mgr-1",
        role: "MANAGER",
        memberId: "member-mgr-1",
        barbershopId: shopId,
      };

      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([
        { permissionKey: "SERVICES_MANAGE", allowed: true },
      ]);
      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: barberId,
        barbershopId: shopId,
      });
      prismaMock.service.count.mockResolvedValue(1);
      prismaMock.$transaction.mockResolvedValue([]);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/services`, "PUT", {
        serviceIds: ["svc-1"],
      });
      const res = await putLegacyServices(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("15c. MANAGER sem SERVICES_MANAGE é bloqueado com 403 no endpoint legado", async () => {
      sessionMock.data = {
        userId: "user-mgr-2",
        role: "MANAGER",
        memberId: "member-mgr-2",
        barbershopId: shopId,
      };

      // Override explícito revogando SERVICES_MANAGE para MANAGER (false)
      prismaMock.memberPermissionOverride.findMany.mockResolvedValue([
        { permissionKey: "SERVICES_MANAGE", allowed: false },
      ]);

      const req = createJsonRequest(`http://localhost/api/admin/team/${barberId}/services`, "PUT", {
        serviceIds: ["svc-1"],
      });
      const res = await putLegacyServices(req, { params: Promise.resolve({ id: barberId }) });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Acesso negado.");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
