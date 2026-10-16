/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getOverview } from "@/app/api/admin/commissions/overview/route";
import { GET as getPayouts } from "@/app/api/admin/commissions/payouts/route";
import { requireOperationalSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershop: {
      findUnique: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    commissionPayout: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("GATE: COMMISSION_OVERVIEW_KPI_PRINT_FIX_LOCAL — API & Calculation Tests", () => {
  const shopA = "shop-dom-brio";
  const shopB = "shop-other-barbershop";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Total pago com ciclos atuais OPEN
  it("1. Total pago acumulado reflete CommissionPayout histórico mesmo quando todos os ciclos atuais estão OPEN", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    // Dois membros ativos, ambos em ciclo OPEN
    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([
      {
        id: "mem-1",
        role: "BARBER",
        user: { id: "u-1", name: "Carlos", email: "carlos@teste.com" },
        commissionCycles: [
          {
            id: "cyc-open-1",
            cycleNumber: 2,
            status: "OPEN",
            grossCommission: new Prisma.Decimal("500.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("100.00"),
            remainingBalance: new Prisma.Decimal("400.00"),
            openedAt: new Date("2026-10-16T00:00:00Z"),
          },
        ],
      },
      {
        id: "mem-2",
        role: "BARBER",
        user: { id: "u-2", name: "João", email: "joao@teste.com" },
        commissionCycles: [
          {
            id: "cyc-open-2",
            cycleNumber: 5,
            status: "OPEN",
            grossCommission: new Prisma.Decimal("800.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("0.00"),
            remainingBalance: new Prisma.Decimal("800.00"),
            openedAt: new Date("2026-10-16T00:00:00Z"),
          },
        ],
      },
    ]);

    // Histórico prévio liquidado via CommissionPayout
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("1115.43") },
      _count: { id: 2 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    const res = await getOverview(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.totalPaidAccumulated).toBe(1115.43);
    expect(json.totalPayoutsCount).toBe(2);
    expect(json.historicalSummary).toEqual({
      totalPaidAccumulated: 1115.43,
      totalPayoutsCount: 2,
    });
    expect(json.overview).toHaveLength(2);
    expect(json.overview[0].currentCycle.status).toBe("OPEN");
    expect(json.overview[1].currentCycle.status).toBe("OPEN");
  });

  // 2. Pagamentos históricos de ciclos PAID
  it("2. Soma e conta pagamentos históricos de liquidação com precisão Decimal", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "MANAGER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([]);
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("4890.75") },
      _count: { id: 7 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    const res = await getOverview(req);
    const json = await res.json();

    expect(json.totalPaidAccumulated).toBe(4890.75);
    expect(json.totalPayoutsCount).toBe(7);
  });

  // 3. Colaboradores inativos incluídos no histórico
  it("3. Inclui pagamentos de colaboradores inativos na agregação do total acumulado", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([]);
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("2500.00") },
      _count: { id: 4 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    await getOverview(req);

    // Confirma que a agregação de CommissionPayout NÃO filtra por isActive do membro,
    // filtrando estritamente pelo barbershopId
    expect(prisma.commissionPayout.aggregate).toHaveBeenCalledWith({
      where: { barbershopId: shopA },
      _sum: { amount: true },
      _count: { id: true },
    });
  });

  // 4. Isolamento entre barbearias (Tenant isolation)
  it("4. Garante estrito isolamento multi-tenant: pagamentos de outra barbearia são ignorados", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin-b",
        barbershopId: shopB,
        role: "OWNER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([]);
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("300.00") },
      _count: { id: 1 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    await getOverview(req);

    // Chamada DEVE ter filtrado estritamente por shopB
    expect(prisma.commissionPayout.aggregate).toHaveBeenCalledWith({
      where: { barbershopId: shopB },
      _sum: { amount: true },
      _count: { id: true },
    });
  });

  // 5. Liquidação de R$ 0,00 tratada corretamente
  it("5. Trata liquidações de R$ 0,00 sem erros de cálculo ou divisões por zero", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([]);
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("0.00") },
      _count: { id: 1 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    const res = await getOverview(req);
    const json = await res.json();

    expect(json.totalPaidAccumulated).toBe(0);
    expect(json.totalPayoutsCount).toBe(1);
    expect(json.historicalSummary.totalPaidAccumulated).toBe(0);
  });

  // 6. Total acumulado em diferentes meses (sem restrição de mês no overview)
  it("6. Total acumulado abrange pagamentos de todos os períodos/meses históricos", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([]);
    // Exemplo Dom Brio: R$ 387,93 + R$ 727,50 em outubro + R$ 500,00 em setembro = R$ 1.615,43
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("1615.43") },
      _count: { id: 3 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    const res = await getOverview(req);
    const json = await res.json();

    expect(json.totalPaidAccumulated).toBe(1615.43);
    expect(json.totalPayoutsCount).toBe(3);
  });

  // 7. Não duplicação de adiantamentos
  it("7. Agrega exclusivamente CommissionPayout, não duplicando adiantamentos na métrica de total pago", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    (prisma.barbershopMember.findMany as any).mockResolvedValueOnce([
      {
        id: "mem-1",
        role: "BARBER",
        user: { id: "u-1", name: "Carlos", email: "carlos@teste.com" },
        commissionCycles: [
          {
            id: "cyc-1",
            cycleNumber: 1,
            status: "OPEN",
            grossCommission: new Prisma.Decimal("1000.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("400.00"), // adiantamento de 400
            remainingBalance: new Prisma.Decimal("600.00"),
            openedAt: new Date("2026-10-01T00:00:00Z"),
          },
        ],
      },
    ]);

    // O aggregate de payouts reflete apenas liquidações registradas (e.g. 0 pagamentos liquidados)
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: null },
      _count: { id: 0 },
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/overview");
    const res = await getOverview(req);
    const json = await res.json();

    // Total pago acumulado DEVE ser 0, não somando os 400 do adiantamento
    expect(json.totalPaidAccumulated).toBe(0);
    expect(json.totalPayoutsCount).toBe(0);
  });

  // 8. Payouts GET retorna identificação da barbearia quando solicitada para relatório de impressão
  it("8. Payouts GET com format=print retorna barbershop com id e name para o relatório impresso", async () => {
    (requireOperationalSession as any).mockResolvedValueOnce({
      error: null,
      data: {
        userId: "user-admin",
        barbershopId: shopA,
        role: "OWNER",
      },
    });

    (prisma.commissionPayout.count as any).mockResolvedValueOnce(2);
    (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("1115.43") },
      _count: { id: 2 },
    });
    (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([
      {
        id: "payout-1",
        cycleId: "cyc-1",
        memberId: "mem-1",
        amount: new Prisma.Decimal("387.93"),
        paymentMethod: "PIX",
        paidAt: new Date("2026-10-10T15:00:00Z"),
        notes: "Primeira quinzena",
        createdAt: new Date("2026-10-10T15:00:00Z"),
        member: { id: "mem-1", role: "BARBER", isActive: true, user: { id: "u-1", name: "Carlos", email: null } },
        cycle: {
          id: "cyc-1",
          cycleNumber: 1,
          status: "PAID",
          grossCommission: new Prisma.Decimal("387.93"),
          adjustmentsTotal: new Prisma.Decimal("0"),
          advancesTotal: new Prisma.Decimal("0"),
          finalPayoutAmount: new Prisma.Decimal("387.93"),
          remainingBalance: new Prisma.Decimal("0"),
          openedAt: new Date("2026-10-01T00:00:00Z"),
          closedAt: new Date("2026-10-10T15:00:00Z"),
          paidAt: new Date("2026-10-10T15:00:00Z"),
        },
        createdBy: { id: "u-admin", name: "Admin" },
      },
    ]);
    (prisma.barbershop.findUnique as any).mockResolvedValueOnce({
      id: shopA,
      name: "Dom Brio Barbearia",
    });

    const req = new NextRequest("http://localhost/api/admin/commissions/payouts?format=print");
    const res = await getPayouts(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.barbershop).toEqual({
      id: shopA,
      name: "Dom Brio Barbearia",
    });
    expect(json.summary.totalPaidAmount).toBe(1115.43);
    expect(json.payouts).toHaveLength(1);
    expect(json.pagination.isPrintMode).toBe(true);
  });
});
