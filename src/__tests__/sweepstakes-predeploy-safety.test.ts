import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  assertTechnicalSimulationAuthorized,
  computeSweepstakeTicketsDigest,
  verifySweepstakeSnapshotIntegrity,
  executeSweepstakeDraw,
  isCustomerClubMemberInPeriod,
} from "@/lib/marketing/sweepstake-engine";

const { mockPrisma, mockSession } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: () => mockSession() }));

import { POST as apurarSweepstakePost } from "@/app/api/admin/marketing/sorteios/[id]/apurar/route";

describe("P0 — Restrição de Servidor das Simulações Técnicas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserva a trava APURACAO_OFICIAL_BLOQUEADA_V1 quando isTechnicalSimulation = false", () => {
    expect(() =>
      assertTechnicalSimulationAuthorized({
        isTechnicalSimulation: false,
        userId: "u-1",
        userRole: "SUPER_ADMIN",
        env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
      })
    ).toThrow(/APURACAO_OFICIAL_BLOQUEADA_V1/);
  });

  it("rejeita usuários comuns e operacionais (USER, BARBER, RECEPTIONIST, MANAGER) mesmo fora de produção", () => {
    for (const role of ["USER", "BARBER", "RECEPTIONIST", "MANAGER"]) {
      expect(() =>
        assertTechnicalSimulationAuthorized({
          isTechnicalSimulation: true,
          userId: "u-common",
          userRole: role,
          env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
        })
      ).toThrow(/SIMULACAO_TECNICA_NAO_AUTORIZADA/);
    }
  });

  it("bloqueia simulações técnicas por padrão em produção (NODE_ENV=production) sem habilitação expressa", () => {
    expect(() =>
      assertTechnicalSimulationAuthorized({
        isTechnicalSimulation: true,
        userId: "u-super",
        userRole: "SUPER_ADMIN",
        userEmail: "admin@tembarber.com.br",
        env: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      })
    ).toThrow(/SIMULACAO_TECNICA_DESABILITADA/);
  });

  it("em produção com SWEEPSTAKE_ENABLE_TECH_SIMULATION=true, bloqueia OWNER não listado em SWEEPSTAKE_TECH_SIMULATION_ALLOWED_USERS", () => {
    expect(() =>
      assertTechnicalSimulationAuthorized({
        isTechnicalSimulation: true,
        userId: "owner-regular",
        userRole: "OWNER",
        userEmail: "dono@barbearia.com",
        env: {
          NODE_ENV: "production",
          SWEEPSTAKE_ENABLE_TECH_SIMULATION: "true",
          SWEEPSTAKE_TECH_SIMULATION_ALLOWED_USERS: "auditor@tembarber.com.br",
        } as NodeJS.ProcessEnv,
      })
    ).toThrow(/SIMULACAO_TECNICA_NAO_AUTORIZADA/);
  });

  it("em produção com SWEEPSTAKE_ENABLE_TECH_SIMULATION=true, autoriza apenas SUPER_ADMIN ou OWNER na allowlist", () => {
    expect(() =>
      assertTechnicalSimulationAuthorized({
        isTechnicalSimulation: true,
        userId: "super-1",
        userRole: "SUPER_ADMIN",
        env: {
          NODE_ENV: "production",
          SWEEPSTAKE_ENABLE_TECH_SIMULATION: "true",
        } as NodeJS.ProcessEnv,
      })
    ).not.toThrow();

    expect(() =>
      assertTechnicalSimulationAuthorized({
        isTechnicalSimulation: true,
        userId: "owner-allowed",
        userRole: "OWNER",
        userEmail: "auditor@tembarber.com.br",
        env: {
          NODE_ENV: "production",
          SWEEPSTAKE_ENABLE_TECH_SIMULATION: "true",
          SWEEPSTAKE_TECH_SIMULATION_ALLOWED_USERS: "auditor@tembarber.com.br,outro@tembarber.com.br",
        } as NodeJS.ProcessEnv,
      })
    ).not.toThrow();
  });

  it("endpoint POST /apurar rejeita manipulação de parâmetros pelo cliente (role/env falsos no body ou tipo inválido) com 403/422 sem abrir transação", async () => {
    mockSession.mockResolvedValue({
      error: null,
      data: {
        userId: "mgr-1",
        barbershopId: "shop-1",
        role: "MANAGER",
        isSuperAdmin: false,
      },
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "mgr-1",
      email: "gerente@barbearia.com",
      role: "MANAGER",
    });

    // Tentativa de escalar privilégio enviando role="SUPER_ADMIN" e isSuperAdmin=true no JSON body
    const req = new NextRequest("http://localhost/api/admin/marketing/sorteios/sw-1/apurar", {
      method: "POST",
      body: JSON.stringify({
        isTechnicalSimulation: true,
        role: "SUPER_ADMIN",
        userRole: "SUPER_ADMIN",
        isSuperAdmin: true,
        SWEEPSTAKE_ENABLE_TECH_SIMULATION: "true",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await apurarSweepstakePost(req, { params: Promise.resolve({ id: "sw-1" }) });
    expect(res.status).toBe(403);
    const payload = await res.json();
    expect(payload.error).toMatch(/SIMULACAO_TECNICA_NAO_AUTORIZADA/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("endpoint POST /apurar trata isTechnicalSimulation não-booleano (ex.: string 'true') como false e bloqueia com APURACAO_OFICIAL_BLOQUEADA_V1", async () => {
    mockSession.mockResolvedValue({
      error: null,
      data: {
        userId: "owner-1",
        barbershopId: "shop-1",
        role: "OWNER",
        isSuperAdmin: false,
      },
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "owner-1",
      email: "owner@barbearia.com",
      role: "OWNER",
    });

    const req = new NextRequest("http://localhost/api/admin/marketing/sorteios/sw-1/apurar", {
      method: "POST",
      body: JSON.stringify({
        isTechnicalSimulation: "true", // String em vez de boolean
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await apurarSweepstakePost(req, { params: Promise.resolve({ id: "sw-1" }) });
    expect(res.status).toBe(422);
    const payload = await res.json();
    expect(payload.error).toMatch(/APURACAO_OFICIAL_BLOQUEADA_V1/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("P0 — Verificação Criptográfica e Relacional de Integridade do Snapshot", () => {
  const baseParticipants = [
    { id: "part-1", customerId: "cust-1", chancesCount: 2 },
    { id: "part-2", customerId: "cust-2", chancesCount: 1 },
  ];
  const baseTickets = [
    { ticketNumber: 1, participantId: "part-1", customerId: "cust-1" },
    { ticketNumber: 2, participantId: "part-1", customerId: "cust-1" },
    { ticketNumber: 3, participantId: "part-2", customerId: "cust-2" },
  ];
  const validDigest = computeSweepstakeTicketsDigest(baseTickets);

  it("aprova snapshot íntegro quando participantes, sequência 1..N e SHA-256 coincidem", () => {
    const digest = verifySweepstakeSnapshotIntegrity({
      ticketsSha256Digest: validDigest,
      totalEligibleCustomers: 2,
      totalChancesAssigned: 3,
      participants: baseParticipants,
      tickets: baseTickets,
    });
    expect(digest).toBe(validDigest);
  });

  it("bloqueia quando um bilhete é adulterado para outro participante/cliente (divergência de SHA-256 ou contagem)", () => {
    expect(() =>
      verifySweepstakeSnapshotIntegrity({
        ticketsSha256Digest: validDigest,
        totalEligibleCustomers: 2,
        totalChancesAssigned: 3,
        // Ajustando chancesCount para tentar burlar a soma, mas o SHA-256 detecta a troca de dono do bilhete #2
        participants: [
          { id: "part-1", customerId: "cust-1", chancesCount: 1 },
          { id: "part-2", customerId: "cust-2", chancesCount: 2 },
        ],
        tickets: [
          { ticketNumber: 1, participantId: "part-1", customerId: "cust-1" },
          { ticketNumber: 2, participantId: "part-2", customerId: "cust-2" }, // Adulterado!
          { ticketNumber: 3, participantId: "part-2", customerId: "cust-2" },
        ],
      })
    ).toThrow(/SNAPSHOT_INTEGRITY_ERROR.*Divergência criptográfica no SHA-256/);
  });

  it("bloqueia quando há lacuna na sequência 1..N de bilhetes ou remoção de bilhete", () => {
    expect(() =>
      verifySweepstakeSnapshotIntegrity({
        ticketsSha256Digest: validDigest,
        totalEligibleCustomers: 2,
        totalChancesAssigned: 3,
        participants: baseParticipants,
        tickets: [
          { ticketNumber: 1, participantId: "part-1", customerId: "cust-1" },
          { ticketNumber: 2, participantId: "part-1", customerId: "cust-1" },
          { ticketNumber: 4, participantId: "part-2", customerId: "cust-2" }, // Lacuna (#3 ausente)
        ],
      })
    ).toThrow(/SNAPSHOT_INTEGRITY_ERROR.*Sequência de bilhetes corrompida/);
  });

  it("executeSweepstakeDraw aborta sem persistir ganhadores ou ata se o snapshot foi adulterado", async () => {
    const mockTx: any = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "sw-tampered", status: "FROZEN" }]),
      customerSweepstake: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "sw-tampered",
          barbershopId: "shop-1",
          status: "FROZEN",
          drawMethod: "ELECTRONIC_DETERMINISTIC",
          precommittedSeed: "seed-123",
          ticketsSha256Digest: validDigest, // Digest original de 3 bilhetes
          totalEligibleCustomers: 2,
          totalChancesAssigned: 3,
          endDateCivil: "2026-10-31",
          endExclusiveUtc: new Date("2026-11-01T03:00:00Z"),
          isRegulatedPromotion: false,
          allowMultiplePrizesPerUser: false,
          prizes: [{ id: "pz-1", position: 1, title: "Prêmio 1" }],
          participants: [
            { id: "part-1", customerId: "cust-1", chancesCount: 1 },
            { id: "part-2", customerId: "cust-2", chancesCount: 2 },
          ],
          tickets: [
            {
              ticketNumber: 1,
              participantId: "part-1",
              participant: { customerId: "cust-1", customer: { id: "cust-1", name: "C1", phone: "111" } },
            },
            {
              // Bilhete #2 teve seu participante trocado de part-1 para part-2 no banco!
              ticketNumber: 2,
              participantId: "part-2",
              participant: { customerId: "cust-2", customer: { id: "cust-2", name: "C2", phone: "222" } },
            },
            {
              ticketNumber: 3,
              participantId: "part-2",
              participant: { customerId: "cust-2", customer: { id: "cust-2", name: "C2", phone: "222" } },
            },
          ],
        }),
        update: vi.fn(),
      },
      customerSweepstakeWinner: { create: vi.fn() },
      customerSweepstakeDrawAudit: { create: vi.fn() },
    };

    await expect(
      executeSweepstakeDraw(mockTx, {
        sweepstakeId: "sw-tampered",
        barbershopId: "shop-1",
        drawnByUserId: "owner-1",
        drawnByUserRole: "OWNER",
        isTechnicalSimulation: true,
      })
    ).rejects.toThrow(/SNAPSHOT_INTEGRITY_ERROR/);

    expect(mockTx.customerSweepstakeWinner.create).not.toHaveBeenCalled();
    expect(mockTx.customerSweepstakeDrawAudit.create).not.toHaveBeenCalled();
    expect(mockTx.customerSweepstake.update).not.toHaveBeenCalled();
  });
});

describe("P1 — Reconstrução Histórica do Clube (Cancelamento, Suspensão, Renovação, Estorno e Competência)", () => {
  const startInclusiveUtc = new Date("2026-10-01T03:00:00.000Z");
  const endExclusiveUtc = new Date("2026-10-16T03:00:00.000Z"); // Campanha de 01/10 a 15/10

  function makeClubTx(overrides: {
    payment?: any;
    usage?: any;
    subscription?: any;
  }) {
    return {
      clubSubscriptionPayment: {
        findFirst: vi.fn().mockResolvedValue(overrides.payment ?? null),
      },
      clubBenefitUsage: {
        findFirst: vi.fn().mockResolvedValue(overrides.usage ?? null),
      },
      customerClubSubscription: {
        findFirst: vi.fn().mockResolvedValue(overrides.subscription ?? null),
      },
    } as any;
  }

  it("bloqueia pagamento tardio na mesma competência (pago em 25/10 após o término da campanha em 15/10)", async () => {
    const tx = makeClubTx({});
    const result = await isCustomerClubMemberInPeriod(tx, {
      barbershopId: "shop-1",
      customerId: "cust-late",
      startInclusiveUtc,
      endExclusiveUtc,
      startMonthCompetence: "2026-10",
      endMonthCompetence: "2026-10",
    });

    expect(result).toBe(false);
    // Verifica que a query exigiu obrigatoriamente paidAt < endExclusiveUtc
    const paymentWhere = tx.clubSubscriptionPayment.findFirst.mock.calls[0][0].where;
    expect(paymentWhere.paidAt).toEqual({ lt: endExclusiveUtc });
  });

  it("reconhece mudança de competência quando o pagamento ocorreu em 20/09 (ciclo de 31 dias cobrindo 01/10..15/10), mesmo que a assinatura tenha sido renovada ou cancelada depois", async () => {
    const tx = makeClubTx({ payment: { id: "pay-sep-20" } });
    const result = await isCustomerClubMemberInPeriod(tx, {
      barbershopId: "shop-1",
      customerId: "cust-cross-month",
      startInclusiveUtc,
      endExclusiveUtc,
      startMonthCompetence: "2026-10",
      endMonthCompetence: "2026-10",
    });

    expect(result).toBe(true);
    const paymentWhere = tx.clubSubscriptionPayment.findFirst.mock.calls[0][0].where;
    const expectedFloor = new Date(startInclusiveUtc.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(paymentWhere.OR).toContainEqual({
      paidAt: { gte: expectedFloor, lt: endExclusiveUtc },
    });
  });

  it("descarta uso de benefício estornado (status REVERSED ou reversedAt preenchido) e rejeita assinatura SUSPENDED/CANCELED sem pagamento válido", async () => {
    const tx = makeClubTx({ payment: null, usage: null, subscription: null });
    const result = await isCustomerClubMemberInPeriod(tx, {
      barbershopId: "shop-1",
      customerId: "cust-reversed",
      startInclusiveUtc,
      endExclusiveUtc,
      startMonthCompetence: "2026-10",
      endMonthCompetence: "2026-10",
    });

    expect(result).toBe(false);
    const usageWhere = tx.clubBenefitUsage.findFirst.mock.calls[0][0].where;
    expect(usageWhere.status).toBe("APPLIED");
    expect(usageWhere.reversedAt).toBeNull();

    const subWhere = tx.customerClubSubscription.findFirst.mock.calls[0][0].where;
    expect(subWhere.status).toEqual({ in: ["ACTIVE", "GRACE_PERIOD"] });
  });
});
