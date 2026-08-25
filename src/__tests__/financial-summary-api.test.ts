/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getFinancialSummary } from "@/app/api/admin/financial/summary/route";
import { requireOperationalSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  return {
    default: {
      comanda: {
        findMany: vi.fn(),
      },
      comandaItem: {
        findMany: vi.fn(),
      },
      payment: {
        findMany: vi.fn(),
      },
      financialEntry: {
        findMany: vi.fn(),
      },
      commissionEntry: {
        findMany: vi.fn(),
      },
    },
  };
});

const mockedRequireOperationalSession = vi.mocked(requireOperationalSession);
const mockedComanda = vi.mocked(prisma.comanda);
const mockedComandaItem = vi.mocked(prisma.comandaItem);
const mockedPayment = vi.mocked(prisma.payment);
const mockedFinancialEntry = vi.mocked(prisma.financialEntry);
const mockedCommissionEntry = vi.mocked(prisma.commissionEntry);

describe("PR #16 — Financial Summary Range API Tests", () => {
  const barbershopId1 = "shop-111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedComandaItem.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createRequest(params: Record<string, string>): NextRequest {
    const url = new URL("http://localhost/api/admin/financial/summary");
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new NextRequest(url);
  }

  it("1. Rejeita se não autenticado (401)", async () => {
    const errorResponse = NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    mockedRequireOperationalSession.mockResolvedValue({
      error: errorResponse,
      data: null,
    } as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    expect(res.status).toBe(401);
  });

  it("2. BARBER recebe 403 (Acesso negado)", async () => {
    const errorResponse = NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    mockedRequireOperationalSession.mockResolvedValue({
      error: errorResponse,
      data: null,
    } as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    expect(res.status).toBe(403);
  });

  it("3. OWNER e MANAGER recebem resumo com sucesso (200)", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.period.startDate).toBe("2026-07-01");
    expect(body.period.endDate).toBe("2026-07-31");
    expect(body.period.timezone).toBe("America/Sao_Paulo");
    expect(body.totals.grossRevenue).toBe(0);
    expect(body.totals.operationalResult).toBe(0);
  });

  it("4. Tenant isolation: busca dados filtrados estritamente pelo barbershopId da sessão", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    await getFinancialSummary(req);

    expect(mockedComanda.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barbershopId: barbershopId1 }),
      })
    );
    expect(mockedPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barbershopId: barbershopId1 }),
      })
    );
  });

  it("5. startDate e endDate são obrigatórios (400)", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    const req = createRequest({ startDate: "2026-07-01" });
    const res = await getFinancialSummary(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("obrigatórias");
  });

  it("6. endDate < startDate retorna 400", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    const req = createRequest({ startDate: "2026-07-31", endDate: "2026-07-01" });
    const res = await getFinancialSummary(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("A data final não pode ser anterior à data inicial");
  });

  it("7. Período de um único dia (startDate === endDate) funciona corretamente", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-15", endDate: "2026-07-15" });
    const res = await getFinancialSummary(req);
    expect(res.status).toBe(200);
  });

  it("8 e 9. Faturamento bruto calcula itens de comanda concluída e descontos reduzem netRevenue", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-1",
            barbershopId: barbershopId1,
            status: "CLOSED",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("10.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("90.00"),
            paidTotal: new Prisma.Decimal("90.00"),
            remainingTotal: new Prisma.Decimal("0.00"),
            closedAt: new Date("2026-07-10T14:00:00Z"),
            items: [
              {
                id: "ci-1",
                comandaId: "c-1",
                barbershopId: barbershopId1,
                type: "SERVICE",
                status: "COMPLETED",
                description: "Corte",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("100.00"),
                discountAmount: new Prisma.Decimal("10.00"),
                total: new Prisma.Decimal("90.00"),
                serviceId: "s-1",
                executorId: "m-barber-1",
                service: { id: "s-1", name: "Corte Social" },
                executor: { id: "m-barber-1", user: { name: "Barbeiro João" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    mockedPayment.findMany.mockResolvedValue([
      {
        id: "p-1",
        barbershopId: barbershopId1,
        comandaId: "c-1",
        method: "PIX",
        amount: new Prisma.Decimal("90.00"),
        status: "CONFIRMED",
        paidAt: new Date("2026-07-10T14:05:00Z"),
      } as any,
    ]);

    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals.grossRevenue).toBe(100);
    expect(body.totals.totalDiscounts).toBe(10);
    expect(body.totals.netRevenue).toBe(90);
    expect(body.totals.totalReceived).toBe(90);
  });

  it("10. Pagamentos por forma de pagamento agrupam corretamente", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-1", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("100.00"), status: "CONFIRMED" } as any,
      { id: "p-2", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("50.00"), status: "CONFIRMED" } as any,
      { id: "p-3", barbershopId: barbershopId1, method: "CREDIT", amount: new Prisma.Decimal("200.00"), status: "CONFIRMED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    const pixMethod = body.paymentMethods.find((m: any) => m.method === "PIX");
    const creditMethod = body.paymentMethods.find((m: any) => m.method === "CREDIT");

    expect(pixMethod.amount).toBe(150);
    expect(pixMethod.count).toBe(2);
    expect(creditMethod.amount).toBe(200);
    expect(creditMethod.count).toBe(1);
    expect(body.totals.totalReceived).toBe(350);
  });

  it("11. Comandas abertas entram em totalReceivable e openCommands, não em totalReceived", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status?.in) {
        return Promise.resolve([
          { id: "c-open-1", remainingTotal: new Prisma.Decimal("50.00") },
          { id: "c-open-2", remainingTotal: new Prisma.Decimal("80.00") },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.openCommands.count).toBe(2);
    expect(body.openCommands.amount).toBe(130);
    expect(body.totals.totalReceivable).toBe(130);
    expect(body.totals.totalReceived).toBe(0);
  });

  it("11.1. Produção de serviços usa itens DONE concluídos dentro da fronteira de São Paulo", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);
    mockedComanda.findMany.mockResolvedValue([]);
    mockedComandaItem.findMany.mockResolvedValue([
      { total: new Prisma.Decimal("35.00") },
    ] as any);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-08-25", endDate: "2026-08-25" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals.serviceProductionGross).toBe(35);
    expect(mockedComandaItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: barbershopId1,
          type: "SERVICE",
          status: "DONE",
          completedAt: {
            gte: new Date("2026-08-25T03:00:00.000Z"),
            lt: new Date("2026-08-26T03:00:00.000Z"),
          },
        }),
      })
    );
  });

  it("12. Comandas canceladas (CANCELLED) não entram no faturamento", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.grossRevenue).toBe(0);
    expect(body.closedCommands.count).toBe(0);
  });

  it("13. Despesas (MANUAL_OUT) reduzem o resultado operacional", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-1", barbershopId: barbershopId1, method: "CASH", amount: new Prisma.Decimal("500.00"), status: "CONFIRMED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([
      { id: "fe-1", barbershopId: barbershopId1, type: "MANUAL_OUT", amount: new Prisma.Decimal("-150.00") } as any,
    ]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.totalReceived).toBe(500);
    expect(body.totals.totalExpenses).toBe(150);
    expect(body.totals.operationalResult).toBe(350); // 500 - 150
  });

  it("14. Comissões liberadas reduzem o resultado operacional", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-1", barbershopId: barbershopId1, method: "CASH", amount: new Prisma.Decimal("1000.00"), status: "CONFIRMED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    (mockedCommissionEntry.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status?.in) {
        return Promise.resolve([
          { memberId: "m-1", releasedAmount: new Prisma.Decimal("300.00"), reversedAmount: new Prisma.Decimal("0.00") },
        ]);
      }
      return Promise.resolve([{ generatedAmount: new Prisma.Decimal("100.00") }]);
    });

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.totalReceived).toBe(1000);
    expect(body.totals.releasedCommissions).toBe(300);
    expect(body.totals.estimatedCommissions).toBe(100);
    expect(body.totals.operationalResult).toBe(700); // 1000 - 300
  });

  it("15. Refund/reversal reduz totalReceived/releasedCommissions e não infla resultado", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-1", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("100.00"), status: "CONFIRMED" } as any,
      { id: "p-ref", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("40.00"), status: "REFUNDED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    (mockedCommissionEntry.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status?.in) {
        return Promise.resolve([
          { memberId: "m-1", releasedAmount: new Prisma.Decimal("30.00"), reversedAmount: new Prisma.Decimal("10.00") },
        ]);
      }
      return Promise.resolve([]);
    });

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.totalReceived).toBe(60); // 100 - 40
    expect(body.totals.releasedCommissions).toBe(20); // 30 - 10
    expect(body.totals.operationalResult).toBe(40); // 60 - 20
  });

  it("16 e 17. topServices e topProfessionals ordenam por netRevenue decrescente", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-1",
            subtotal: new Prisma.Decimal("150.00"),
            discountTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("150.00"),
            items: [
              {
                id: "ci-1",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("50.00"),
                total: new Prisma.Decimal("50.00"),
                serviceId: "s-barba",
                executorId: "m-barber-2",
                service: { id: "s-barba", name: "Barba" },
                executor: { id: "m-barber-2", user: { name: "Barbeiro Pedro" } },
              },
              {
                id: "ci-2",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("100.00"),
                total: new Prisma.Decimal("100.00"),
                serviceId: "s-corte",
                executorId: "m-barber-1",
                service: { id: "s-corte", name: "Corte Premium" },
                executor: { id: "m-barber-1", user: { name: "Barbeiro Max" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.topServices[0].serviceName).toBe("Corte Premium");
    expect(body.topServices[0].netRevenue).toBe(100);
    expect(body.topServices[1].serviceName).toBe("Barba");
    expect(body.topServices[1].netRevenue).toBe(50);

    expect(body.topProfessionals[0].name).toBe("Barbeiro Max");
    expect(body.topProfessionals[0].netRevenue).toBe(100);
    expect(body.topProfessionals[1].name).toBe("Barbeiro Pedro");
    expect(body.topProfessionals[1].netRevenue).toBe(50);
  });

  it("18. usa fronteira local de Sao Paulo com endExclusive", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-15", endDate: "2026-07-15" });
    await getFinancialSummary(req);

    expect(mockedPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paidAt: {
            gte: new Date(Date.UTC(2026, 6, 15, 3, 0, 0, 0)),
            lt: new Date(Date.UTC(2026, 6, 16, 3, 0, 0, 0)),
          },
        }),
      })
    );
  });

  it("19. MANUAL_IN entra em totalReceived e operationalResult sem entrar em paymentMethods", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-1", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("100.00"), status: "CONFIRMED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([
      { id: "fe-in", barbershopId: barbershopId1, type: "MANUAL_IN", amount: new Prisma.Decimal("40.00") } as any,
      { id: "fe-out", barbershopId: barbershopId1, type: "MANUAL_OUT", amount: new Prisma.Decimal("-15.00") } as any,
    ]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.commandReceived).toBe(100);
    expect(body.totals.manualIncome).toBe(40);
    expect(body.totals.manualExpenses).toBe(15);
    expect(body.totals.totalReceived).toBe(140);
    expect(body.totals.totalExpenses).toBe(15);
    expect(body.totals.operationalResult).toBe(125);
    const pixMethod = body.paymentMethods.find((m: any) => m.method === "PIX");
    expect(pixMethod.amount).toBe(100);
  });

  it("20. surcharge entra no netRevenue e closedCommands.amount", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-surcharge",
            barbershopId: barbershopId1,
            status: "CLOSED",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("10.00"),
            surchargeTotal: new Prisma.Decimal("15.00"),
            total: new Prisma.Decimal("105.00"),
            items: [],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([
      { id: "p-surcharge", barbershopId: barbershopId1, method: "PIX", amount: new Prisma.Decimal("105.00"), status: "CONFIRMED" } as any,
    ]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.grossRevenue).toBe(100);
    expect(body.totals.totalDiscounts).toBe(10);
    expect(body.totals.totalSurcharges).toBe(15);
    expect(body.totals.netRevenue).toBe(105);
    expect(body.closedCommands.amount).toBe(105);
    expect(body.totals.commandReceived).toBe(105);
  });

  it("21. rateia desconto global nos rankings sem alterar cards gerais ou grossRevenue", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-discount-ranking",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("10.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("90.00"),
            items: [
              {
                id: "ci-discount",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("100.00"),
                total: new Prisma.Decimal("100.00"),
                serviceId: "s-corte",
                executorId: "m-barber-1",
                service: { id: "s-corte", name: "Corte" },
                executor: { id: "m-barber-1", user: { name: "Barbeiro Max" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();

    expect(body.totals.grossRevenue).toBe(100);
    expect(body.totals.totalDiscounts).toBe(10);
    expect(body.totals.netRevenue).toBe(90);
    expect(body.closedCommands.amount).toBe(90);
    expect(body.topServices[0].grossRevenue).toBe(100);
    expect(body.topServices[0].netRevenue).toBe(90);
    expect(body.topProfessionals[0].grossRevenue).toBe(100);
    expect(body.topProfessionals[0].netRevenue).toBe(90);
  });

  it("22. rateia acrescimo global nos rankings", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-surcharge-ranking",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("0.00"),
            surchargeTotal: new Prisma.Decimal("20.00"),
            total: new Prisma.Decimal("120.00"),
            items: [
              {
                id: "ci-surcharge",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("100.00"),
                total: new Prisma.Decimal("100.00"),
                serviceId: "s-corte",
                executorId: "m-barber-1",
                service: { id: "s-corte", name: "Corte" },
                executor: { id: "m-barber-1", user: { name: "Barbeiro Max" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();

    expect(body.totals.totalSurcharges).toBe(20);
    expect(body.totals.netRevenue).toBe(120);
    expect(body.topServices[0].grossRevenue).toBe(100);
    expect(body.topServices[0].netRevenue).toBe(120);
    expect(body.topProfessionals[0].netRevenue).toBe(120);
  });

  it("23. distribui desconto proporcional entre dois servicos", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-proportional",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("10.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("90.00"),
            items: [
              {
                id: "ci-70",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("70.00"),
                total: new Prisma.Decimal("70.00"),
                serviceId: "s-a",
                executorId: "m-a",
                service: { id: "s-a", name: "Servico A" },
                executor: { id: "m-a", user: { name: "Prof A" } },
              },
              {
                id: "ci-30",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("30.00"),
                total: new Prisma.Decimal("30.00"),
                serviceId: "s-b",
                executorId: "m-b",
                service: { id: "s-b", name: "Servico B" },
                executor: { id: "m-b", user: { name: "Prof B" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();
    const serviceA = body.topServices.find((s: any) => s.serviceId === "s-a");
    const serviceB = body.topServices.find((s: any) => s.serviceId === "s-b");

    expect(serviceA.netRevenue).toBe(63);
    expect(serviceB.netRevenue).toBe(27);
    expect(body.topServices.reduce((sum: number, service: any) => sum + service.netRevenue, 0)).toBe(90);
  });

  it("24. corrige arredondamento no ultimo item para bater exatamente com total da comanda", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-rounding",
            subtotal: new Prisma.Decimal("99.99"),
            discountTotal: new Prisma.Decimal("0.99"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("99.00"),
            items: [
              {
                id: "ci-r1",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("33.33"),
                total: new Prisma.Decimal("33.33"),
                serviceId: "s-r1",
                executorId: "m-r1",
                service: { id: "s-r1", name: "R1" },
                executor: { id: "m-r1", user: { name: "R1" } },
              },
              {
                id: "ci-r2",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("33.33"),
                total: new Prisma.Decimal("33.33"),
                serviceId: "s-r2",
                executorId: "m-r2",
                service: { id: "s-r2", name: "R2" },
                executor: { id: "m-r2", user: { name: "R2" } },
              },
              {
                id: "ci-r3",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("33.33"),
                total: new Prisma.Decimal("33.33"),
                serviceId: "s-r3",
                executorId: "m-r3",
                service: { id: "s-r3", name: "R3" },
                executor: { id: "m-r3", user: { name: "R3" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();
    const rankingTotal = body.topServices.reduce((sum: number, service: any) => sum + service.netRevenue, 0);

    expect(body.totals.netRevenue).toBe(99);
    expect(rankingTotal).toBe(99);
    expect(body.topServices).toHaveLength(3);
  });

  it("25. profissionais usam liquido rateado e comissao liberada permanece separada", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-professionals",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("10.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("90.00"),
            items: [
              {
                id: "ci-prof-a",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("70.00"),
                total: new Prisma.Decimal("70.00"),
                serviceId: "s-pa",
                executorId: "m-pa",
                service: { id: "s-pa", name: "Servico PA" },
                executor: { id: "m-pa", user: { name: "Prof A" } },
              },
              {
                id: "ci-prof-b",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("30.00"),
                total: new Prisma.Decimal("30.00"),
                serviceId: "s-pb",
                executorId: "m-pb",
                service: { id: "s-pb", name: "Servico PB" },
                executor: { id: "m-pb", user: { name: "Prof B" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    (mockedCommissionEntry.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status?.in) {
        return Promise.resolve([
          { memberId: "m-pa", releasedAmount: new Prisma.Decimal("12.00"), reversedAmount: new Prisma.Decimal("0.00") },
        ]);
      }
      return Promise.resolve([]);
    });

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();
    const profA = body.topProfessionals.find((p: any) => p.memberId === "m-pa");
    const profB = body.topProfessionals.find((p: any) => p.memberId === "m-pb");

    expect(profA.netRevenue).toBe(63);
    expect(profA.releasedCommissions).toBe(12);
    expect(profB.netRevenue).toBe(27);
    expect(profB.releasedCommissions).toBe(0);
  });

  it("26. sem desconto ou acrescimo mantem ranking igual ao item.total", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-no-adjustment",
            subtotal: new Prisma.Decimal("80.00"),
            discountTotal: new Prisma.Decimal("0.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("80.00"),
            items: [
              {
                id: "ci-no-adjustment",
                type: "SERVICE",
                status: "DONE",
                quantity: new Prisma.Decimal("1"),
                unitPrice: new Prisma.Decimal("80.00"),
                total: new Prisma.Decimal("80.00"),
                serviceId: "s-no-adjustment",
                executorId: "m-no-adjustment",
                service: { id: "s-no-adjustment", name: "Sem Ajuste" },
                executor: { id: "m-no-adjustment", user: { name: "Prof Sem Ajuste" } },
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();

    expect(body.totals.netRevenue).toBe(80);
    expect(body.topServices[0].grossRevenue).toBe(80);
    expect(body.topServices[0].netRevenue).toBe(80);
    expect(body.topProfessionals[0].netRevenue).toBe(80);
  });

  it("27. LOTE B: inclui clubRevenue no resumo financeiro de forma separada sem duplicação (FT10, FT11)", async () => {
    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    (mockedComanda.findMany as any).mockImplementation((args: any) => {
      if (args?.where?.status === "CLOSED") {
        return Promise.resolve([
          {
            id: "c-closed",
            subtotal: new Prisma.Decimal("100.00"),
            discountTotal: new Prisma.Decimal("0.00"),
            surchargeTotal: new Prisma.Decimal("0.00"),
            total: new Prisma.Decimal("100.00"),
            items: [],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    mockedPayment.findMany.mockResolvedValue([
      {
        id: "pay-1",
        barbershopId: barbershopId1,
        method: "PIX",
        amount: new Prisma.Decimal("100.00"),
        status: "PAID",
        paidAt: new Date("2026-07-15T10:00:00Z"),
      } as any,
    ]);

    mockedFinancialEntry.findMany.mockResolvedValue([
      {
        id: "fe-manual",
        barbershopId: barbershopId1,
        type: "MANUAL_IN",
        category: "SUPPLY",
        amount: new Prisma.Decimal("50.00"),
        entryDate: new Date("2026-07-15T12:00:00Z"),
      } as any,
      {
        id: "fe-club",
        barbershopId: barbershopId1,
        type: "CLUB_REVENUE",
        category: "PIX",
        amount: new Prisma.Decimal("120.00"),
        entryDate: new Date("2026-07-15T14:00:00Z"),
      } as any,
    ]);

    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const res = await getFinancialSummary(createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals.commandReceived).toBe(100);
    expect(body.totals.manualIncome).toBe(50);
    expect(body.totals.clubRevenue).toBe(120);
    expect(body.totals.totalReceived).toBe(270);
  });
});
