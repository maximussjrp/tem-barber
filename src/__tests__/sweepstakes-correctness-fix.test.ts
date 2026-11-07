import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  calculateSweepstakeEligibility,
  executeSweepstakeDraw,
  isCustomerClubMemberInPeriod,
  selectSweepstakeWinners,
  HmacDeterministicRNG,
  type DrawableTicket,
} from "@/lib/marketing/sweepstake-engine";

const { mockPrisma, mockSession } = vi.hoisted(() => ({
  mockPrisma: {
    customerSweepstake: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: () => mockSession() }));

import { DELETE as deleteSweepstake } from "@/app/api/admin/marketing/sorteios/[id]/route";

// Bilhetes: cliente A possui 10 bilhetes (1..10), cliente B possui 1 bilhete (11)
function ticketsDominatedByOneCustomer(): DrawableTicket[] {
  const list: DrawableTicket[] = [];
  for (let i = 1; i <= 10; i++) list.push({ ticketNumber: i, participantId: "p-A", customerId: "cust-A" });
  list.push({ ticketNumber: 11, participantId: "p-B", customerId: "cust-B" });
  return list;
}

function buildMockTx() {
  return {
    appointment: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
    clubSubscriptionPayment: { findFirst: vi.fn().mockResolvedValue(null) },
    clubBenefitUsage: { findFirst: vi.fn().mockResolvedValue(null) },
    customerClubSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    customerSweepstake: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    customerSweepstakeWinner: { create: vi.fn() },
    customerSweepstakeDrawAudit: { create: vi.fn() },
    $queryRaw: vi.fn(),
  } as any;
}

describe("P0 — Ganhadores duplicados (allowMultiplePrizesPerUser = false)", () => {
  it("nunca contempla o mesmo cliente duas vezes, mesmo quando um cliente domina os bilhetes", () => {
    // RNG adversarial: sempre retorna o menor índice (antes, o fallback escolhia bilhete do cliente A)
    const rng = { nextInt: (min: number) => min };
    const winners = selectSweepstakeWinners({
      tickets: ticketsDominatedByOneCustomer(),
      prizePositions: [1, 2],
      allowMultiplePrizesPerUser: false,
      method: { kind: "ELECTRONIC_DETERMINISTIC", rng },
    });
    expect(winners).toHaveLength(2);
    expect(new Set(winners.map((w) => w.customerId)).size).toBe(2);
    expect(winners.map((w) => w.customerId).sort()).toEqual(["cust-A", "cust-B"]);
  });

  it("valida insuficiência de clientes distintos ANTES da apuração", () => {
    const tickets: DrawableTicket[] = [1, 2, 3].map((n) => ({ ticketNumber: n, participantId: "p-A", customerId: "cust-A" }));
    expect(() =>
      selectSweepstakeWinners({
        tickets,
        prizePositions: [1, 2],
        allowMultiplePrizesPerUser: false,
        method: { kind: "ELECTRONIC_DETERMINISTIC", rng: new HmacDeterministicRNG("seed") },
      })
    ).toThrow(/INSUFFICIENT_ELIGIBLE_PARTICIPANTS/);
  });

  it("é determinístico: mesma semente produz o mesmo resultado com múltiplos prêmios", () => {
    const run = () =>
      selectSweepstakeWinners({
        tickets: ticketsDominatedByOneCustomer(),
        prizePositions: [1, 2],
        allowMultiplePrizesPerUser: false,
        method: { kind: "ELECTRONIC_DETERMINISTIC", rng: new HmacDeterministicRNG("semente-fixa") },
      });
    expect(run()).toEqual(run());
  });

  it("permite o mesmo cliente em prêmios distintos quando allowMultiplePrizesPerUser = true (bilhetes distintos)", () => {
    const tickets: DrawableTicket[] = [1, 2, 3].map((n) => ({ ticketNumber: n, participantId: "p-A", customerId: "cust-A" }));
    const winners = selectSweepstakeWinners({
      tickets,
      prizePositions: [1, 2, 3],
      allowMultiplePrizesPerUser: true,
      method: { kind: "ELECTRONIC_DETERMINISTIC", rng: new HmacDeterministicRNG("s") },
    });
    expect(new Set(winners.map((w) => w.ticketNumber)).size).toBe(3);
  });

  it("executeSweepstakeDraw não grava ganhadores, ata nem status quando a apuração falha", async () => {
    const tx = buildMockTx();
    tx.$queryRaw.mockResolvedValue([{ id: "sw-1", status: "FROZEN" }]);
    tx.customerSweepstake.findUniqueOrThrow.mockResolvedValue({
      id: "sw-1",
      endDateCivil: "2026-10-31",
      endExclusiveUtc: new Date("2026-11-01T03:00:00Z"),
      isRegulatedPromotion: false,
      allowMultiplePrizesPerUser: false,
      drawMethod: "ELECTRONIC_DETERMINISTIC",
      precommittedSeed: "abc",
      prizes: [{ position: 1 }, { position: 2 }],
      tickets: [1, 2].map((n) => ({
        ticketNumber: n,
        participantId: "p-A",
        participant: { customerId: "cust-A", customer: { id: "cust-A", name: "Cliente Atlas", phone: "000" } },
      })),
    });

    await expect(
      executeSweepstakeDraw(tx, {
        sweepstakeId: "sw-1",
        barbershopId: "shop-1",
        drawnByUserId: "u-1",
        isTechnicalSimulation: true,
      })
    ).rejects.toThrow(/INSUFFICIENT_ELIGIBLE_PARTICIPANTS/);

    expect(tx.customerSweepstakeWinner.create).not.toHaveBeenCalled();
    expect(tx.customerSweepstakeDrawAudit.create).not.toHaveBeenCalled();
    expect(tx.customerSweepstake.update).not.toHaveBeenCalled();
  });
});

describe("P0 — Loteria Federal sem loop infinito", () => {
  it("rejeita (sem travar) quando não há clientes distintos suficientes", () => {
    const tickets: DrawableTicket[] = [1, 2, 3, 4].map((n) => ({ ticketNumber: n, participantId: "p-A", customerId: "cust-A" }));
    const started = Date.now();
    expect(() =>
      selectSweepstakeWinners({
        tickets,
        prizePositions: [1, 2],
        allowMultiplePrizesPerUser: false,
        method: { kind: "FEDERAL_LOTTERY", premios: ["12345", "12345"] },
      })
    ).toThrow(/INSUFFICIENT_ELIGIBLE_PARTICIPANTS/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("avança ciclicamente até o próximo cliente distinto, respeitando a não repetição", () => {
    // premio 1 -> 10 % 11 + 1 = 11 (cust-B); premio 2 -> também 11 => avança 1 (cust-A)
    const winners = selectSweepstakeWinners({
      tickets: ticketsDominatedByOneCustomer(),
      prizePositions: [1, 2],
      allowMultiplePrizesPerUser: false,
      method: { kind: "FEDERAL_LOTTERY", premios: ["10", "10"] },
    });
    expect(winners.map((w) => w.ticketNumber)).toEqual([11, 1]);
    expect(new Set(winners.map((w) => w.customerId)).size).toBe(2);
  });

  it("a apuração oficial (não simulada) continua bloqueada na V1", async () => {
    const tx = buildMockTx();
    tx.$queryRaw.mockResolvedValue([{ id: "sw-1", status: "FROZEN" }]);
    tx.customerSweepstake.findUniqueOrThrow.mockResolvedValue({
      id: "sw-1",
      endDateCivil: "2026-10-31",
      endExclusiveUtc: new Date("2026-11-01T03:00:00Z"),
      isRegulatedPromotion: false,
      allowMultiplePrizesPerUser: false,
      drawMethod: "FEDERAL_LOTTERY",
      prizes: [{ position: 1 }],
      tickets: [
        { ticketNumber: 1, participantId: "p-A", participant: { customerId: "cust-A", customer: { name: "A", phone: "0" } } },
      ],
    });
    await expect(
      executeSweepstakeDraw(tx, {
        sweepstakeId: "sw-1",
        barbershopId: "shop-1",
        drawnByUserId: "u-1",
        federalLotteryConcurso: "5900",
        isTechnicalSimulation: false,
      })
    ).rejects.toThrow(/APURACAO_OFICIAL_BLOQUEADA_V1/);
    expect(tx.customerSweepstakeWinner.create).not.toHaveBeenCalled();
  });
});

describe("P1 — Filtro de serviços (itens sem serviceId)", () => {
  it("campanha de corte conta apenas cortes; barba, serviço avulso sem ID e produtos não geram chances", async () => {
    const tx = buildMockTx();
    tx.appointment.findMany.mockResolvedValue([
      {
        id: "app-1",
        customerId: "cust-A",
        dateTime: new Date(Date.UTC(2026, 9, 10, 14, 0, 0)),
        status: "COMPLETED",
        customer: { id: "cust-A", name: "Cliente Atlas", phone: "000" },
        services: [{ serviceId: "srv-corte", service: { name: "Corte" } }],
        comandas: [
          {
            id: "cmd-1",
            closedAt: new Date("2026-10-10T18:00:00Z"),
            items: [
              { id: "i1", serviceId: "srv-corte", completedAt: new Date("2026-10-10T17:30:00Z"), quantity: new Prisma.Decimal(1), service: { name: "Corte" } },
              { id: "i2", serviceId: "srv-barba", completedAt: new Date("2026-10-10T17:45:00Z"), quantity: new Prisma.Decimal(1), service: { name: "Barba" } },
              { id: "i3", serviceId: null, description: "Serviço avulso", completedAt: new Date("2026-10-10T17:50:00Z"), quantity: new Prisma.Decimal(1), service: null },
            ],
          },
        ],
      },
    ]);
    tx.comanda.findMany.mockResolvedValue([
      {
        id: "cmd-avulsa",
        customerId: "cust-B",
        openedAt: new Date("2026-10-12T13:00:00Z"),
        closedAt: new Date("2026-10-12T14:00:00Z"),
        status: "CLOSED",
        customer: { id: "cust-B", name: "Cliente Orion", phone: "000" },
        items: [
          { id: "j1", serviceId: null, description: "Serviço sem cadastro", completedAt: new Date("2026-10-12T13:30:00Z"), quantity: new Prisma.Decimal(1), service: null },
          { id: "j2", serviceId: null, description: "Pomada (produto)", completedAt: new Date("2026-10-12T13:40:00Z"), quantity: new Prisma.Decimal(2), service: null },
        ],
      },
    ]);

    const result = await calculateSweepstakeEligibility(tx, {
      barbershopId: "shop-1",
      startDateCivil: "2026-10-01",
      endDateCivil: "2026-10-31",
      participationMode: "ONE_PER_SERVICE",
      targetSegment: "ALL_CUSTOMERS",
      serviceIds: ["srv-corte"],
    });

    expect(result.totalEligibleCustomers).toBe(1);
    expect(result.participants[0].customerId).toBe("cust-A");
    expect(result.totalChances).toBe(1);
    expect(result.participants[0].chanceOrigins.map((o) => o.serviceId)).toEqual(["srv-corte"]);

    // Produtos são excluídos já na consulta (type = SERVICE)
    const cmdQuery = tx.comanda.findMany.mock.calls[0][0];
    expect(cmdQuery.include.items.where.type).toBe("SERVICE");
  });
});

describe("P1 — Data real de execução (completedAt) em comandas vinculadas", () => {
  const baseApp = (dateTime: Date, completedAt: Date) => ({
    id: "app-x",
    customerId: "cust-A",
    dateTime,
    status: "COMPLETED",
    customer: { id: "cust-A", name: "Cliente Atlas", phone: "000" },
    services: [{ serviceId: "srv-corte", service: { name: "Corte" } }],
    comandas: [
      {
        id: "cmd-x",
        closedAt: completedAt,
        items: [{ id: "it", serviceId: "srv-corte", completedAt, quantity: new Prisma.Decimal(1), service: { name: "Corte" } }],
      },
    ],
  });

  const run = async (app: any) => {
    const tx = buildMockTx();
    tx.appointment.findMany.mockResolvedValue([app]);
    tx.comanda.findMany.mockResolvedValue([]);
    const r = await calculateSweepstakeEligibility(tx, {
      barbershopId: "shop-1",
      startDateCivil: "2026-10-01",
      endDateCivil: "2026-10-31",
      participationMode: "ONE_PER_SERVICE",
      targetSegment: "ALL_CUSTOMERS",
    });
    return { r, tx };
  };

  it("agendado em 30/09 e concluído em 01/10 (SP) entra na campanha de outubro", async () => {
    const { r, tx } = await run(baseApp(new Date(Date.UTC(2026, 8, 30, 18, 0, 0)), new Date("2026-10-01T15:00:00Z")));
    expect(r.totalChances).toBe(1);
    // A consulta busca também agendamentos fora do período com serviço concluído no período
    const where = tx.appointment.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
  });

  it("agendado em 31/10 e concluído em 01/11 (SP) NÃO entra na campanha de outubro", async () => {
    const { r } = await run(baseApp(new Date(Date.UTC(2026, 9, 31, 18, 0, 0)), new Date("2026-11-01T12:00:00Z")));
    expect(r.totalChances).toBe(0);
    expect(r.totalEligibleCustomers).toBe(0);
  });

  it("respeita intervalo semiaberto em America/Sao_Paulo (31/10 23:59 SP entra; 01/11 00:00 SP não)", async () => {
    const inside = await run(baseApp(new Date(Date.UTC(2026, 9, 31, 20, 0, 0)), new Date("2026-11-01T02:59:59Z")));
    expect(inside.r.totalChances).toBe(1);
    const outside = await run(baseApp(new Date(Date.UTC(2026, 9, 31, 20, 0, 0)), new Date("2026-11-01T03:00:00Z")));
    expect(outside.r.totalChances).toBe(0);
  });
});

describe("Clube — fallback não classifica assinatura cancelada como ativa", () => {
  it("restringe o fallback por datas a status ACTIVE/GRACE_PERIOD", async () => {
    const tx = buildMockTx();
    await isCustomerClubMemberInPeriod(tx, {
      barbershopId: "shop-1",
      customerId: "cust-A",
      startInclusiveUtc: new Date("2026-10-01T03:00:00Z"),
      endExclusiveUtc: new Date("2026-11-01T03:00:00Z"),
      startMonthCompetence: "2026-10",
      endMonthCompetence: "2026-10",
    });
    const where = tx.customerClubSubscription.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["ACTIVE", "GRACE_PERIOD"] });
  });
});

describe("Imutabilidade — DELETE não cancela campanha apurada/auditada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ error: null, data: { userId: "u-1", barbershopId: "shop-1", role: "OWNER" } });
  });

  const callDelete = () =>
    deleteSweepstake(new NextRequest("http://localhost:3000/api/admin/marketing/sorteios/sw-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "sw-1" }),
    });

  it.each(["DRAWN", "AUDITED", "CANCELLED"])("rejeita DELETE de campanha %s sem alterar registros", async (status) => {
    mockPrisma.customerSweepstake.findUnique.mockResolvedValue({ id: "sw-1", status });
    const res = await callDelete();
    expect(res.status).toBe(422);
    expect(mockPrisma.customerSweepstake.update).not.toHaveBeenCalled();
    expect(mockPrisma.customerSweepstake.delete).not.toHaveBeenCalled();
  });

  it("ainda permite cancelar campanha FROZEN (não apurada)", async () => {
    mockPrisma.customerSweepstake.findUnique.mockResolvedValue({ id: "sw-1", status: "FROZEN" });
    mockPrisma.customerSweepstake.update.mockResolvedValue({ id: "sw-1", status: "CANCELLED" });
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(mockPrisma.customerSweepstake.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } })
    );
  });
});
