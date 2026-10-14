import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ComandaStatus, ComandaItemType, MemberRole } from "@prisma/client";

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
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    memberPermissionOverride: { findMany: vi.fn() },
    service: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    product: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    comanda: { findFirst: vi.fn(), findUnique: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() },
    comandaItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findMany: vi.fn() },
    customerCreditAccount: { findFirst: vi.fn() },
    customerCreditLedger: { findMany: vi.fn() },
    customerClubSubscription: { findMany: vi.fn() },
    clubPlanBenefit: { findMany: vi.fn() },
    customerClubBenefitLedger: { findMany: vi.fn() },
    appointment: { findUnique: vi.fn() },
    commissionConfig: { findMany: vi.fn() },
    commissionEntry: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn() },
    careerLevel: { findFirst: vi.fn() },
    serviceCommissionRule: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return {
    ...actual,
    requireOperationalSession: vi.fn().mockImplementation(() => Promise.resolve(sessionMock)),
  };
});
vi.mock("@/lib/operations/customer-credit", () => ({
  getCustomerCreditAccount: vi.fn().mockResolvedValue({ balance: 0 }),
}));

import { POST as postComandaItem } from "@/app/api/admin/comandas/[id]/items/route";
import { GET as getComanda } from "@/app/api/admin/comandas/[id]/route";
import { addProductItem } from "@/lib/operations/comandas";

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const shopId = "shop-1";
const comandaId = "cmd-1";
const ownerMemberId = "member-owner-1";
const barber1Id = "barber-1";
const barber2Id = "barber-2";
const inactiveBarberId = "barber-inactive";
const otherShopBarberId = "barber-other-shop";
const productId = "prod-1";

describe("TEM BARBER — Gate P2-C: Identificação correta do vendedor de produtos", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    sessionMock.data = {
      userId: "user-owner-1",
      role: "OWNER",
      memberId: ownerMemberId,
      barbershopId: shopId,
    };
    sessionMock.error = null;

    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)
    );

    const comandaFixture = {
      id: comandaId,
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      customerId: "cust-1",
      appointmentId: "appt-1",
      items: [],
      payments: [],
      appointment: {
        id: "appt-1",
        memberId: barber1Id,
        barber: { user: { name: "Barbeiro 1" } },
      },
    };

    prismaMock.comanda.findFirst.mockResolvedValue(comandaFixture);
    prismaMock.comanda.findFirstOrThrow.mockResolvedValue(comandaFixture);
    prismaMock.comanda.findUnique.mockResolvedValue({
      id: comandaId,
      customerId: "cust-1",
      barbershopId: shopId,
      openedAt: new Date(),
    });

    prismaMock.$queryRaw.mockResolvedValue([{ id: comandaId }]);

    // Mock Product
    prismaMock.product.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === productId && where.barbershopId === shopId && where.isActive === true) {
        return Promise.resolve({
          id: productId,
          barbershopId: shopId,
          name: "Pomada Modeladora",
          salePrice: "50.00",
          trackStock: false,
          currentStock: 10,
          isActive: true,
        });
      }
      return Promise.resolve(null);
    });

    // Mock Members
    prismaMock.barbershopMember.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === barber1Id && where.barbershopId === shopId && where.isActive === true) {
        return Promise.resolve({
          id: barber1Id,
          barbershopId: shopId,
          role: "BARBER" as MemberRole,
          isActive: true,
          services: [],
          user: { name: "Barbeiro Um" },
        });
      }
      if (where.id === barber2Id && where.barbershopId === shopId && where.isActive === true) {
        return Promise.resolve({
          id: barber2Id,
          barbershopId: shopId,
          role: "BARBER" as MemberRole,
          isActive: true,
          services: [],
          user: { name: "Barbeiro Dois" },
        });
      }
      if (where.id === ownerMemberId && where.barbershopId === shopId && where.isActive === true) {
        return Promise.resolve({
          id: ownerMemberId,
          barbershopId: shopId,
          role: "OWNER" as MemberRole,
          isActive: true,
          services: [],
          user: { name: "Proprietário" },
        });
      }
      return Promise.resolve(null);
    });

    prismaMock.comandaItem.create.mockImplementation((args: any) =>
      Promise.resolve({ id: "item-created", ...args.data })
    );

    prismaMock.comandaItem.findMany.mockResolvedValue([]);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
    prismaMock.appointment.findUnique.mockResolvedValue({ memberId: barber1Id });
    prismaMock.commissionConfig.findMany.mockResolvedValue([]);
    prismaMock.commissionEntry.findMany.mockResolvedValue([]);
    prismaMock.comanda.update.mockResolvedValue({ id: comandaId });
  });

  describe("Operação addProductItem", () => {
    it("1. Inclui produto com vendedor válido da mesma barbearia gravando executorId", async () => {
      const result = await addProductItem(prismaMock as any, {
        comandaId,
        barbershopId: shopId,
        productId,
        executorId: barber1Id,
        quantity: 1,
      });

      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          comandaId,
          barbershopId: shopId,
          productId,
          executorId: barber1Id,
          type: ComandaItemType.PRODUCT,
          description: "Pomada Modeladora",
        }),
      });
      expect(result).toBeDefined();
    });

    it("3. Rejeita vendedor de outro tenant com OPERATIONAL ERROR (INVALID_EXECUTOR)", async () => {
      await expect(
        addProductItem(prismaMock as any, {
          comandaId,
          barbershopId: shopId,
          productId,
          executorId: otherShopBarberId,
        })
      ).rejects.toThrow("Profissional invalido.");
    });

    it("4. Rejeita vendedor inativo com OPERATIONAL ERROR (INVALID_EXECUTOR)", async () => {
      await expect(
        addProductItem(prismaMock as any, {
          comandaId,
          barbershopId: shopId,
          productId,
          executorId: inactiveBarberId,
        })
      ).rejects.toThrow("Profissional invalido.");
    });

    it("10. A validação do vendedor não depende de vínculo BarberService (membro sem serviços aceito)", async () => {
      // barber2Id has services: []
      await expect(
        addProductItem(prismaMock as any, {
          comandaId,
          barbershopId: shopId,
          productId,
          executorId: barber2Id,
        })
      ).resolves.toBeDefined();
    });
  });

  describe("API POST /api/admin/comandas/[id]/items", () => {
    it("2. Produto sem executorId retorna HTTP 400", async () => {
      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        // executorId ausente
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("SELLER_REQUIRED");
    });

    it("2b. Produto com executorId vazio ou apenas espaços retorna HTTP 400", async () => {
      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: "   ",
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("SELLER_REQUIRED");
    });

    it("7. Sessão BARBER não pode atribuir venda a outro profissional (retorna 403)", async () => {
      sessionMock.data.role = "BARBER";
      sessionMock.data.memberId = barber1Id;

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber2Id, // Tentando atribuir ao barbeiro 2
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("BARBER_SELLER_MISMATCH");
    });

    it("7b. Sessão BARBER pode atribuir venda para si mesmo (executorId === data.memberId)", async () => {
      sessionMock.data.role = "BARBER";
      sessionMock.data.memberId = barber1Id;

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber1Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executorId: barber1Id,
          }),
        })
      );
    });

    it("8. OWNER pode atribuir venda a qualquer membro ativo da barbearia", async () => {
      sessionMock.data.role = "OWNER";
      sessionMock.data.memberId = ownerMemberId;

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber2Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executorId: barber2Id,
          }),
        })
      );
    });

    it("9. RECEPTIONIST pode registrar vendedor ativo conforme autorização da comanda", async () => {
      sessionMock.data.role = "RECEPTIONIST";
      sessionMock.data.memberId = "member-receptionist-1";

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber1Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executorId: barber1Id,
          }),
        })
      );
    });

    it("5. Comanda avulsa (sem agendamento) aceita vendedor explícito", async () => {
      prismaMock.comanda.findFirst.mockResolvedValue({
        id: "cmd-walkin",
        barbershopId: shopId,
        status: ComandaStatus.OPEN,
        customerId: null,
        appointmentId: null,
        items: [],
        appointment: null,
      });

      const req = createJsonRequest(`http://localhost/api/admin/comandas/cmd-walkin/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber2Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: "cmd-walkin" }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            comandaId: "cmd-walkin",
            executorId: barber2Id,
          }),
        })
      );
    });

    it("6. Vendedor diferente do executor do agendamento/serviço é preservado", async () => {
      // appointment.memberId = barber1Id, mas a venda é feita por barber2Id
      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "PRODUCT",
        productId,
        executorId: barber2Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executorId: barber2Id,
          }),
        })
      );
    });

    it("16. Serviços continuam funcionando sem alterações", async () => {
      prismaMock.service.findFirst.mockResolvedValue({
        id: "svc-1",
        barbershopId: shopId,
        name: "Corte Cabelo",
        price: "40.00",
        isActive: true,
      });

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}/items`, "POST", {
        type: "SERVICE",
        serviceId: "svc-1",
        executorId: barber1Id,
      });

      const res = await postComandaItem(req, { params: Promise.resolve({ id: comandaId }) });
      expect(res.status).toBe(201);
      expect(prismaMock.comandaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ComandaItemType.SERVICE,
            executorId: barber1Id,
            serviceId: "svc-1",
          }),
        })
      );
    });
  });

  describe("API GET /api/admin/comandas/[id]", () => {
    it("11. GET retorna lista availableSellers contendo apenas membros ativos do tenant", async () => {
      prismaMock.barbershopMember.findMany.mockResolvedValue([
        { id: barber1Id, user: { name: "Barbeiro Um" } },
        { id: barber2Id, user: { name: "Barbeiro Dois" } },
        { id: ownerMemberId, user: { name: "Proprietário" } },
      ]);

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}`, "GET");
      const res = await getComanda(req, { params: Promise.resolve({ id: comandaId }) });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.availableSellers).toBeDefined();
      expect(data.availableSellers).toHaveLength(3);
      expect(data.availableSellers[0]).toEqual({ id: barber1Id, user: { name: "Barbeiro Um" } });

      // Verificação de tenant e status ativo
      expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith({
        where: {
          barbershopId: shopId,
          isActive: true,
        },
        select: {
          id: true,
          user: {
            select: { name: true },
          },
        },
        orderBy: {
          user: { name: "asc" },
        },
      });
    });

    it("11b. Para sessão BARBER, availableSellers filtra estritamente para o próprio barbeiro", async () => {
      sessionMock.data.role = "BARBER";
      sessionMock.data.memberId = barber1Id;

      prismaMock.barbershopMember.findMany.mockResolvedValue([
        { id: barber1Id, user: { name: "Barbeiro Um" } },
      ]);

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}`, "GET");
      const res = await getComanda(req, { params: Promise.resolve({ id: comandaId }) });

      expect(res.status).toBe(200);
      expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barbershopId: shopId,
            isActive: true,
            id: barber1Id,
          }),
        })
      );
    });

    it("15. Resposta da comanda apresenta o vendedor correto nos itens", async () => {
      prismaMock.comanda.findFirst.mockResolvedValue({
        id: comandaId,
        barbershopId: shopId,
        status: ComandaStatus.OPEN,
        items: [
          {
            id: "item-prod-1",
            type: "PRODUCT",
            productId,
            description: "Pomada Modeladora",
            executorId: barber2Id,
            executor: { id: barber2Id, user: { name: "Barbeiro Dois" } },
          },
        ],
      });
      prismaMock.barbershopMember.findMany.mockResolvedValue([]);

      const req = createJsonRequest(`http://localhost/api/admin/comandas/${comandaId}`, "GET");
      const res = await getComanda(req, { params: Promise.resolve({ id: comandaId }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items[0].executorId).toBe(barber2Id);
      expect(data.items[0].executor.user.name).toBe("Barbeiro Dois");
    });
  });

  describe("P2-C-FIX: Escopo de propriedade da comanda (isLegacyOwnComanda)", () => {
    it("vendedor de produto (executorId em item PRODUCT) NÃO possui ownership sobre a comanda", async () => {
      const { isLegacyOwnComanda } = await import("@/lib/operations/permissions");

      const comandaWithOnlyProductSold = {
        appointment: null,
        items: [
          { executorId: barber1Id, type: "PRODUCT" },
        ],
      };

      expect(isLegacyOwnComanda(comandaWithOnlyProductSold, barber1Id)).toBe(false);
    });

    it("executor de serviço (executorId em item SERVICE) possui ownership sobre a comanda", async () => {
      const { isLegacyOwnComanda } = await import("@/lib/operations/permissions");

      const comandaWithServiceExecuted = {
        appointment: null,
        items: [
          { executorId: barber1Id, type: "SERVICE" },
        ],
      };

      expect(isLegacyOwnComanda(comandaWithServiceExecuted, barber1Id)).toBe(true);
    });

    it("barbeiro do agendamento possui ownership mesmo se outro membro vender produto", async () => {
      const { isLegacyOwnComanda } = await import("@/lib/operations/permissions");

      const comandaWithAppointment = {
        appointment: { memberId: barber1Id },
        items: [
          { executorId: barber2Id, type: "PRODUCT" },
        ],
      };

      expect(isLegacyOwnComanda(comandaWithAppointment, barber1Id)).toBe(true);
      expect(isLegacyOwnComanda(comandaWithAppointment, barber2Id)).toBe(false);
    });
  });
});
